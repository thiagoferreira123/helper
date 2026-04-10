import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { BugJobData } from '../queue/queue.service';

export interface AnalysisResult {
  file: string;
  line: number;
  rootCause: string;
  confidence: number;
}

export interface FixResult {
  summary: string;
  explanation: string;
}

export interface TestResult {
  passed: boolean;
  total: number;
  failures: number;
  output: string;
}

// Features que existem no frontend — tudo que não estiver aqui vai para o backend
const FRONTEND_FEATURES = new Set([
  'dashboard', 'patients', 'patients-overview', 'patient', 'patient-dashboard',
  'patient-files', 'patient-report', 'patient-public-registration',
  'meal-plan-builder', 'meal-plan-builder-refactor', 'plan-builder', 'templates',
  'recipes', 'nutritional-guidance', 'food-diary-gallery', 'manipulated-formula', 'products',
  'anamnesis', 'exams', 'exam-analysis-ia', 'medical-records', 'body-scan',
  'comparative-photos', 'weight-evolution', 'goals',
  'anthropometry-adult', 'anthropometry-pediatric', 'anthropometry-pregnant',
  'anthropometry-bioimpedance', 'caloric-expenditure',
  'calendar', 'scheduling', 'chat', 'chats', 'whatsapp-integration', 'notifications',
  'billing', 'checkout', 'financial-control', 'affiliate',
  'admin-panel', 'settings', 'users', 'form-builder', 'apps',
  'club', 'news', 'tutorials', 'shared-materials', 'insights', 'tasks',
  'auth', 'onboarding', 'audio-transcription', 'document-verification',
]);

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly frontRepoPath: string;
  private readonly backRepoPath: string;

  constructor(private readonly config: ConfigService) {
    this.frontRepoPath = this.config.get('FRONT_REPO_PATH', '/repos/front-new');
    this.backRepoPath = this.config.get('BACK_REPO_PATH', '/repos/back');
  }

  /** Retorna o repo correto baseado na feature reportada */
  getRepoPath(service: string): string {
    return FRONTEND_FEATURES.has(service) ? this.frontRepoPath : this.backRepoPath;
  }

  async analyze(
    data: BugJobData,
    onLog: (log: string) => void,
  ): Promise<AnalysisResult> {
    const prompt = this.buildAnalysisPrompt(data);
    const repoPath = this.getRepoPath(data.service);
    const output = await this.runClaude(prompt, data, repoPath, onLog);
    const json = this.extractJson(output);
    return {
      file: json.file,
      line: json.line,
      rootCause: json.rootCause,
      confidence: json.confidence,
    };
  }

  async applyFix(
    analysis: AnalysisResult,
    data: BugJobData,
    onLog: (log: string) => void,
  ): Promise<FixResult> {
    const prompt = this.buildFixPrompt(analysis, data);
    const repoPath = this.getRepoPath(data.service);
    const output = await this.runClaude(prompt, data, repoPath, onLog);
    const json = this.extractJson(output);
    return {
      summary: json.summary,
      explanation: json.explanation,
    };
  }

  async runTests(repoPath: string, onLog: (log: string) => void): Promise<TestResult> {
    return new Promise((resolve) => {
      const proc = spawn('npm', ['run', 'test', '--', '--passWithNoTests'], {
        cwd: repoPath,
        env: { ...process.env },
        shell: true,
      });

      let output = '';

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        onLog(text);
      });

      proc.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });

      proc.on('close', (code) => {
        const failures = (output.match(/FAIL /g) || []).length;
        const total = output.match(/Tests:\s+(\d+)/)?.[1] ?? '0';
        resolve({
          passed: code === 0,
          total: parseInt(total),
          failures,
          output,
        });
      });
    });
  }

  async fixFailingTests(
    testResult: TestResult,
    repoPath: string,
    onLog: (log: string) => void,
  ): Promise<void> {
    const prompt = `
Os testes abaixo falharam após a correção do bug. Corrija APENAS os testes
quebrados sem alterar o comportamento da aplicação. Não remova testes.

Output dos testes:
${testResult.output}

Responda em JSON: { "summary": "o que foi corrigido nos testes" }
    `.trim();

    await this.runClaude(prompt, null, repoPath, onLog);
  }

  private runClaude(
    prompt: string,
    data: BugJobData | null,
    repoPath: string,
    onLog: (log: string) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let imagePath: string | null = null;
      if (data?.imageBase64) {
        const tmpDir = `/tmp/bug-agent-${Date.now()}`;
        mkdirSync(tmpDir, { recursive: true });
        imagePath = join(
          tmpDir,
          `screenshot.${data.imageMimeType?.split('/')[1] ?? 'png'}`,
        );
        writeFileSync(imagePath, Buffer.from(data.imageBase64, 'base64'));
      }

      let fullPrompt = prompt;
      if (imagePath) {
        fullPrompt += `\n\nScreenshot do bug salvo em: ${imagePath}\nUse a ferramenta Read para visualizar a imagem.`;
      }

      const args = [
        '-p',
        fullPrompt,
        '--dangerously-skip-permissions',
        '--output-format',
        'text',
        '--max-budget-usd',
        '5',
      ];

      this.logger.debug(
        `Spawning Claude Code: claude -p ... --dangerously-skip-permissions`,
      );

      const proc = spawn('claude', args, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NO_COLOR: '1',
          TERM: 'dumb',
        },
      });

      // Fechar stdin imediatamente para evitar warning de "no stdin data"
      proc.stdin.end();

      let output = '';
      let errorOutput = '';

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        onLog(text.slice(0, 300));
      });

      proc.stderr.on('data', (chunk) => {
        errorOutput += chunk.toString();
      });

      proc.on('close', (code) => {
        if (imagePath) {
          try {
            rmSync(imagePath, { force: true });
          } catch {}
        }

        if (code === 0) {
          resolve(output);
        } else {
          reject(
            new Error(
              `Claude Code saiu com código ${code}\nSTDERR: ${errorOutput.slice(0, 500)}`,
            ),
          );
        }
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Timeout: Claude Code demorou mais de 20 minutos'));
      }, 20 * 60 * 1000);

      proc.on('close', () => clearTimeout(timeout));
    });
  }

  private buildAnalysisPrompt(data: BugJobData): string {
    return `
Você é um agente especializado na stack do DietSystem:
- Backend: NestJS 11, TypeORM 0.3, MySQL, BullMQ, Valkey/Redis
- Frontend: React 19, Vite 7, TanStack Router/Query, Zustand, shadcn/ui, Tailwind CSS 4, i18next
- Testes: Jest (back) e Vitest (front)

O frontend é organizado por features em src/features/<nome>/. Cada feature tem seus componentes, hooks e services.
Features existentes: dashboard, patients, patients-overview, patient, patient-dashboard, patient-files, patient-report, patient-public-registration, meal-plan-builder, meal-plan-builder-refactor, plan-builder, templates, recipes, nutritional-guidance, food-diary-gallery, manipulated-formula, products, anamnesis, exams, exam-analysis-ia, medical-records, body-scan, comparative-photos, weight-evolution, goals, anthropometry-adult, anthropometry-pediatric, anthropometry-pregnant, anthropometry-bioimpedance, caloric-expenditure, calendar, scheduling, chat, chats, whatsapp-integration, notifications, billing, checkout, financial-control, affiliate, admin-panel, settings, users, form-builder, apps, club, news, tutorials, shared-materials, insights, tasks, auth, onboarding, audio-transcription, document-verification.

Analise o bug abaixo e localize o arquivo e linha exatos no código.

RELATO:
Feature: ${data.service}
Severidade: ${data.severity}
Reportado por: ${data.reportedBy}
Descrição: ${data.description}

INSTRUÇÕES:
1. Comece pela pasta src/features/${data.service}/ — ali estão os componentes, hooks e services dessa feature
2. Localize o arquivo e a linha exatos do bug
3. Identifique a causa raiz — considere: queries TypeORM, guards de auth, interceptors, React Query cache, rotas TanStack Router, estado Zustand, validações Zod/React Hook Form
4. NÃO corrija nada ainda — apenas analise

Responda SOMENTE com JSON válido, sem markdown, sem texto extra:
{
  "file": "caminho/relativo/do/arquivo.ts",
  "line": 42,
  "rootCause": "descrição clara da causa raiz",
  "confidence": 85
}
    `.trim();
  }

  private buildFixPrompt(
    analysis: AnalysisResult,
    data: BugJobData,
  ): string {
    return `
Você é um agente especializado na stack do DietSystem:
- Backend: NestJS 11, TypeORM 0.3, MySQL, BullMQ, Valkey/Redis
- Frontend: React 19, Vite 7, TanStack Router/Query, Zustand, shadcn/ui, Tailwind CSS 4, i18next
- Testes: Jest (back) e Vitest (front)

O frontend é organizado por features em src/features/<nome>/. Cada feature tem seus componentes, hooks e services.
Imports usam @/ como alias para src/. Componentes UI ficam em @/components/ui/ (shadcn). Toasts usam sonner. Formulários usam React Hook Form + Zod. API usa axios via @/lib/api.ts. Auth via Zustand em @/stores/auth-store.ts.

Corrija o bug identificado abaixo.

BUG LOCALIZADO:
Arquivo: ${analysis.file}
Linha: ${analysis.line}
Causa raiz: ${analysis.rootCause}

RELATO ORIGINAL:
${data.description}

REGRAS OBRIGATÓRIAS:
1. Corrija APENAS o bug identificado — não refatore nada além do necessário
2. Respeite os padrões do projeto: imports com @/, shadcn/ui, TypeORM repositories, NestJS DI
3. Se o bug for no frontend, mantenha compatibilidade com i18next (chaves de tradução existentes)
4. Não faça push nem commit — apenas edite os arquivos
5. Se alterar queries TypeORM, garanta que os relations e joins estão corretos
6. Prefira soluções já existentes no código — não reinvente

Responda SOMENTE com JSON válido após aplicar o fix:
{
  "summary": "fix(${data.service}): descrição curta em até 72 chars",
  "explanation": "explicação detalhada do que foi corrigido e por quê"
}
    `.trim();
  }

  private extractJson(output: string): any {
    const clean = output
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(
        `Claude não retornou JSON válido.\nOutput: ${output.slice(0, 300)}`,
      );
    }

    return JSON.parse(match[0]);
  }
}
