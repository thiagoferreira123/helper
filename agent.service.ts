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

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly repoPath: string;

  constructor(private readonly config: ConfigService) {
    this.repoPath = this.config.getOrThrow('REPO_PATH');
  }

  // ── Análise: localiza o bug no código ────────────────────────────────────

  async analyze(
    data: BugJobData,
    onLog: (log: string) => void,
  ): Promise<AnalysisResult> {
    const prompt = this.buildAnalysisPrompt(data);
    const output = await this.runClaude(prompt, data, onLog);

    // Claude retorna JSON estruturado — parseamos
    const json = this.extractJson(output);
    return {
      file: json.file,
      line: json.line,
      rootCause: json.rootCause,
      confidence: json.confidence,
    };
  }

  // ── Fix: aplica a correção ────────────────────────────────────────────────

  async applyFix(
    analysis: AnalysisResult,
    data: BugJobData,
    onLog: (log: string) => void,
  ): Promise<FixResult> {
    const prompt = this.buildFixPrompt(analysis, data);
    const output = await this.runClaude(prompt, data, onLog);

    const json = this.extractJson(output);
    return {
      summary: json.summary,
      explanation: json.explanation,
    };
  }

  // ── Testes ────────────────────────────────────────────────────────────────

  async runTests(onLog: (log: string) => void): Promise<TestResult> {
    return new Promise((resolve) => {
      const proc = spawn('npm', ['run', 'test', '--', '--passWithNoTests'], {
        cwd: this.repoPath,
        env: { ...process.env },
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
        const total = (output.match(/Tests:\s+(\d+)/)?.[1]) ?? '0';
        resolve({
          passed: code === 0,
          total: parseInt(total),
          failures,
          output,
        });
      });
    });
  }

  // ── Corrige testes que quebraram por causa do fix ─────────────────────────

  async fixFailingTests(
    testResult: TestResult,
    onLog: (log: string) => void,
  ): Promise<void> {
    const prompt = `
Os testes abaixo falharam após a correção do bug. Corrija APENAS os testes
quebrados sem alterar o comportamento da aplicação. Não remova testes.

Output dos testes:
${testResult.output}

Responda em JSON: { "summary": "o que foi corrigido nos testes" }
    `.trim();

    await this.runClaude(prompt, null, onLog);
  }

  // ── Runner principal do Claude Code CLI ──────────────────────────────────

  private runClaude(
    prompt: string,
    data: BugJobData | null,
    onLog: (log: string) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Salva imagem em disco temporário se existir
      let imagePath: string | null = null;
      if (data?.imageBase64) {
        const tmpDir = `/tmp/bug-agent-${Date.now()}`;
        mkdirSync(tmpDir, { recursive: true });
        imagePath = join(tmpDir, `screenshot.${data.imageMimeType?.split('/')[1] ?? 'png'}`);
        writeFileSync(imagePath, Buffer.from(data.imageBase64, 'base64'));
      }

      const args = [
        'claude',
        // ─── flag crítico: sem isso o agente para e pede confirmação ───
        '--dangerously-skip-permissions',
        // ─── modo não-interativo obrigatório para rodar em servidor ────
        '--no-interactive',
        // ─── output em texto puro, sem formatação de terminal ──────────
        '--output-format', 'text',
        // ─── máximo de turnos antes de desistir ────────────────────────
        '--max-turns', '30',
        // ─── prompt via flag -p ────────────────────────────────────────
        '-p', prompt,
      ];

      if (imagePath) {
        args.push('--image', imagePath);
      }

      this.logger.debug(`Spawning Claude Code: npx ${args.slice(0, 4).join(' ')} ...`);

      const proc = spawn('npx', args, {
        cwd: this.repoPath,          // Claude Code opera dentro do repo
        env: {
          ...process.env,
          // sem cores no output — facilita o parsing
          NO_COLOR: '1',
          TERM: 'dumb',
        },
      });

      let output = '';
      let errorOutput = '';

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        onLog(text.slice(0, 300)); // limita o tamanho do log por chunk
      });

      proc.stderr.on('data', (chunk) => {
        errorOutput += chunk.toString();
      });

      proc.on('close', (code) => {
        // limpa arquivo temporário da imagem
        if (imagePath) {
          try { rmSync(imagePath, { force: true }); } catch {}
        }

        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(
            `Claude Code saiu com código ${code}\nSTDERR: ${errorOutput.slice(0, 500)}`
          ));
        }
      });

      // timeout de segurança: 20 minutos por chamada
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Timeout: Claude Code demorou mais de 20 minutos'));
      }, 20 * 60 * 1000);

      proc.on('close', () => clearTimeout(timeout));
    });
  }

  // ── Prompts ───────────────────────────────────────────────────────────────

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

  private buildFixPrompt(analysis: AnalysisResult, data: BugJobData): string {
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

  // ── Utilitário: extrai JSON do output do Claude ───────────────────────────

  private extractJson(output: string): any {
    // Remove markdown code fences se existirem
    const clean = output
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    // Encontra o primeiro { ... } válido
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Claude não retornou JSON válido.\nOutput: ${output.slice(0, 300)}`);
    }

    return JSON.parse(match[0]);
  }
}
