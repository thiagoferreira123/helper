import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { BugJobData } from '../queue/queue.service';
import { getFeatureMapText } from './feature-map';

export interface ResearchResult {
  files: string[];
  rootCause: string;
  suggestedApproach: string;
  references: string[];
}

export interface FixResult {
  summary: string;
  explanation: string;
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

  getRepoPath(service: string): string {
    return FRONTEND_FEATURES.has(service) ? this.frontRepoPath : this.backRepoPath;
  }

  /** Etapa 1: Pesquisador — entende o problema, pesquisa na web e documentação */
  async research(
    data: BugJobData,
    onLog: (log: string) => void,
  ): Promise<ResearchResult> {
    const repoPath = this.getRepoPath(data.service);
    const isFrontend = FRONTEND_FEATURES.has(data.service);
    const prompt = this.buildResearchPrompt(data, isFrontend);
    const output = await this.runCodex(prompt, data, repoPath, onLog);
    return this.extractJson(output);
  }

  /** Etapa 2: Especialista — corrige o bug e roda testes */
  async fix(
    research: ResearchResult,
    data: BugJobData,
    onLog: (log: string) => void,
  ): Promise<FixResult> {
    const repoPath = this.getRepoPath(data.service);
    const isFrontend = FRONTEND_FEATURES.has(data.service);
    const prompt = this.buildFixPrompt(research, data, isFrontend);
    const output = await this.runCodex(prompt, data, repoPath, onLog);
    return this.extractJson(output);
  }

  private buildResearchPrompt(data: BugJobData, isFrontend: boolean): string {
    const stack = isFrontend
      ? `React 19, Vite 7, TanStack Router/Query, Zustand, shadcn/ui, Tailwind CSS 4, i18next, Vitest.
O frontend é organizado por features em src/features/<nome>/. Cada feature tem seus componentes, hooks e services.`
      : `NestJS 11, TypeORM 0.3, MySQL, BullMQ, Valkey/Redis, Jest.`;

    const featureMap = isFrontend ? getFeatureMapText(data.service) : '';

    return `
Você é um pesquisador de bugs. Seu trabalho é ENTENDER o problema a fundo antes que um especialista corrija.

STACK DO PROJETO:
${stack}

${featureMap ? `MAPA DO CÓDIGO:\n${featureMap}\n` : ''}BUG REPORTADO:
Feature: ${data.service}
Severidade: ${data.severity}
Reportado por: ${data.reportedBy}
Descrição: ${data.description}

SUAS TAREFAS:
1. Vá DIRETO aos arquivos indicados no mapa acima — não fique buscando pela codebase
2. Pesquise na web por issues conhecidas, bugs similares na documentação oficial das libs envolvidas (${isFrontend ? 'React, TanStack Query, Zustand, shadcn/ui, Tailwind' : 'NestJS, TypeORM, BullMQ'})
3. Consulte a documentação oficial para confirmar o uso correto das APIs envolvidas
4. Identifique a causa raiz com clareza
5. Sugira a abordagem de correção — mas NÃO corrija nada, NÃO edite nenhum arquivo

Responda SOMENTE com JSON válido, sem markdown:
{
  "files": ["caminho/relativo/arquivo1.ts", "caminho/relativo/arquivo2.ts"],
  "rootCause": "descrição clara e detalhada da causa raiz",
  "suggestedApproach": "como o bug deve ser corrigido, passo a passo",
  "references": ["links de documentação ou issues relevantes encontrados"]
}
    `.trim();
  }

  private buildFixPrompt(
    research: ResearchResult,
    data: BugJobData,
    isFrontend: boolean,
  ): string {
    const stack = isFrontend
      ? `React 19, Vite 7, TanStack Router/Query, Zustand, shadcn/ui, Tailwind CSS 4, i18next, Vitest.
Imports usam @/ como alias para src/. Componentes UI ficam em @/components/ui/ (shadcn). Toasts usam sonner. Formulários usam React Hook Form + Zod. API usa axios via @/lib/api.ts. Auth via Zustand em @/stores/auth-store.ts.`
      : `NestJS 11, TypeORM 0.3, MySQL, BullMQ, Valkey/Redis, Jest.
Usa NestJS DI, TypeORM repositories, class-validator para DTOs, Guards para auth.`;

    const featureMap = isFrontend ? getFeatureMapText(data.service) : '';

    return `
Você é um especialista sênior em ${isFrontend ? 'React e frontend moderno' : 'NestJS e backend Node.js'}.
Outro agente já pesquisou e diagnosticou o bug. Seu trabalho é CORRIGIR o código e garantir que os testes passem.

STACK DO PROJETO:
${stack}

${featureMap ? `MAPA DO CÓDIGO:\n${featureMap}\n` : ''}PESQUISA DO BUG:
Arquivos envolvidos: ${research.files.join(', ')}
Causa raiz: ${research.rootCause}
Abordagem sugerida: ${research.suggestedApproach}
Referências: ${research.references.join(', ') || 'nenhuma'}

RELATO ORIGINAL:
${data.description}

REGRAS OBRIGATÓRIAS:
1. Corrija APENAS o bug identificado — não refatore nada além do necessário
2. Respeite os padrões do projeto: ${isFrontend ? 'imports com @/, shadcn/ui, i18next' : 'TypeORM repositories, NestJS DI, class-validator'}
3. Após corrigir, rode os testes (npm run test -- --passWithNoTests) e corrija se algum quebrar
4. Não faça push nem commit — apenas edite os arquivos
5. Prefira soluções já existentes no código — não reinvente

Responda SOMENTE com JSON válido após aplicar o fix:
{
  "summary": "fix(${data.service}): descrição curta em até 72 chars",
  "explanation": "explicação detalhada do que foi corrigido e por quê"
}
    `.trim();
  }

  private runCodex(
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
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        '--model',
        'gpt-5.4-medium',
        fullPrompt,
      ];

      this.logger.debug(`Spawning Codex: codex exec --dangerously-bypass-approvals-and-sandbox --model gpt-5.4-medium ...`);

      const proc = spawn('codex', args, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NO_COLOR: '1',
          TERM: 'dumb',
        },
      });

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
          try { rmSync(imagePath, { force: true }); } catch {}
        }

        if (code === 0) {
          resolve(output);
        } else {
          reject(
            new Error(`Codex saiu com código ${code}\nSTDERR: ${errorOutput.slice(0, 500)}`),
          );
        }
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Timeout: Codex demorou mais de 20 minutos'));
      }, 20 * 60 * 1000);

      proc.on('close', () => clearTimeout(timeout));
    });
  }

  private extractJson(output: string): any {
    const clean = output
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Codex não retornou JSON válido.\nOutput: ${output.slice(0, 300)}`);
    }

    return JSON.parse(match[0]);
  }
}
