import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from 'fs';
import { join, relative } from 'path';
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

interface FileEdit {
  file: string;
  search: string;
  replace: string;
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

  /** Etapa 1: Pesquisador — lê arquivos da feature e analisa com IA */
  async research(
    data: BugJobData,
    onLog: (log: string) => void,
  ): Promise<ResearchResult> {
    const repoPath = this.getRepoPath(data.service);
    const isFrontend = FRONTEND_FEATURES.has(data.service);

    onLog('Lendo arquivos da feature...');
    const fileContents = this.readFeatureFiles(repoPath, data.service);
    onLog(`${fileContents.size} arquivos lidos`);

    const prompt = this.buildResearchPrompt(data, isFrontend, fileContents);
    onLog(`Consultando GPT-5.4 (pesquisa, ${prompt.length} chars)...`);
    const output = await this.callOpenAI(prompt, data);
    return this.extractJson(output);
  }

  /** Etapa 2: Especialista — corrige o bug via edits retornados pela IA */
  async fix(
    research: ResearchResult,
    data: BugJobData,
    onLog: (log: string) => void,
  ): Promise<FixResult> {
    const repoPath = this.getRepoPath(data.service);
    const isFrontend = FRONTEND_FEATURES.has(data.service);

    // Ler arquivos identificados pela pesquisa
    onLog('Lendo arquivos identificados...');
    const fileContents = this.readSpecificFiles(repoPath, research.files);

    const prompt = this.buildFixPrompt(research, data, isFrontend, fileContents);
    onLog(`Consultando GPT-5.4 (correção, ${prompt.length} chars)...`);
    const output = await this.callOpenAI(prompt, null);
    const result = this.extractJson(output);

    // Aplicar edits no sistema de arquivos
    if (result.edits && Array.isArray(result.edits)) {
      for (const edit of result.edits as FileEdit[]) {
        const filePath = join(repoPath, edit.file);
        if (!existsSync(filePath)) {
          onLog(`AVISO: arquivo não encontrado: ${edit.file}`);
          continue;
        }
        let content = readFileSync(filePath, 'utf-8');
        if (!content.includes(edit.search)) {
          onLog(`AVISO: trecho não encontrado em ${edit.file}`);
          continue;
        }
        content = content.replace(edit.search, edit.replace);
        writeFileSync(filePath, content);
        onLog(`Editado: ${edit.file}`);
      }
    }

    return { summary: result.summary, explanation: result.explanation };
  }

  // ─── OpenAI REST API ──────────────────────────────────────────────────

  private async callOpenAI(
    prompt: string,
    data: BugJobData | null,
  ): Promise<string> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');

    const content: any[] = [];

    // Imagem (screenshot do bug)
    if (data?.imageBase64) {
      content.push({
        type: 'input_image',
        image_url: `data:${data.imageMimeType || 'image/png'};base64,${data.imageBase64}`,
      });
    }

    content.push({ type: 'input_text', text: prompt });

    const body = {
      model: 'gpt-5.4',
      input: [{ role: 'user', content }],
    };

    this.logger.debug(`Chamando OpenAI API (${prompt.length} chars, imagem: ${!!data?.imageBase64})`);

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${errBody.slice(0, 500)}`);
    }

    const json = await res.json();
    const text = json.output?.[0]?.content?.[0]?.text;
    if (!text) {
      throw new Error(
        `OpenAI retornou resposta vazia: ${JSON.stringify(json).slice(0, 500)}`,
      );
    }

    this.logger.debug(`OpenAI respondeu (${text.length} chars)`);
    return text;
  }

  // ─── Leitura de arquivos ──────────────────────────────────────────────

  /** Lê todos os arquivos .ts/.tsx da feature + arquivos compartilhados */
  private readFeatureFiles(
    repoPath: string,
    service: string,
  ): Map<string, string> {
    const files = new Map<string, string>();

    // Feature dir
    const featureDir = join(repoPath, `src/features/${service}`);
    this.walkDir(featureDir, repoPath, files, 30);

    // Arquivos compartilhados importantes
    const sharedFiles = [
      'src/lib/api.ts',
      'src/lib/utils.ts',
      'src/stores/auth-store.ts',
    ];
    for (const f of sharedFiles) {
      const full = join(repoPath, f);
      if (existsSync(full)) {
        try {
          const content = readFileSync(full, 'utf-8');
          if (content.length < 20_000) files.set(f, content);
        } catch {}
      }
    }

    return files;
  }

  /** Lê arquivos específicos por caminho relativo */
  private readSpecificFiles(
    repoPath: string,
    filePaths: string[],
  ): Map<string, string> {
    const files = new Map<string, string>();
    for (const f of filePaths) {
      const full = join(repoPath, f);
      if (existsSync(full)) {
        try {
          const content = readFileSync(full, 'utf-8');
          files.set(f, content);
        } catch {}
      }
    }
    return files;
  }

  /** Lê arquivos .ts/.tsx recursivamente de um diretório */
  private walkDir(
    dir: string,
    repoPath: string,
    files: Map<string, string>,
    maxFiles: number,
    depth = 0,
  ): void {
    if (depth > 5 || files.size >= maxFiles || !existsSync(dir)) return;
    let entries: any[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as any[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.size >= maxFiles) break;
      const full = join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== 'node_modules' &&
        entry.name !== 'dist'
      ) {
        this.walkDir(full, repoPath, files, maxFiles, depth + 1);
      } else if (
        entry.isFile() &&
        /\.(ts|tsx|js|jsx)$/.test(entry.name)
      ) {
        try {
          const content = readFileSync(full, 'utf-8');
          if (content.length < 20_000) {
            const rel = relative(repoPath, full).replace(/\\/g, '/');
            files.set(rel, content);
          }
        } catch {}
      }
    }
  }

  /** Formata Map de arquivos para incluir no prompt */
  private formatFiles(files: Map<string, string>): string {
    if (files.size === 0) return '(nenhum arquivo encontrado)';
    let result = '';
    for (const [path, content] of files) {
      result += `\n--- ${path} ---\n${content}\n`;
    }
    return result;
  }

  // ─── Prompts ──────────────────────────────────────────────────────────

  private buildResearchPrompt(
    data: BugJobData,
    isFrontend: boolean,
    fileContents: Map<string, string>,
  ): string {
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

CÓDIGO DA FEATURE (leia com atenção):
${this.formatFiles(fileContents)}

SUAS TAREFAS:
1. Analise o código acima e identifique a causa raiz do bug reportado
2. Liste os arquivos envolvidos com caminho relativo exato
3. Sugira a abordagem de correção — mas NÃO corrija nada

Responda SOMENTE com JSON válido, sem markdown:
{
  "files": ["caminho/relativo/arquivo1.ts", "caminho/relativo/arquivo2.ts"],
  "rootCause": "descrição clara e detalhada da causa raiz",
  "suggestedApproach": "como o bug deve ser corrigido, passo a passo",
  "references": []
}
    `.trim();
  }

  private buildFixPrompt(
    research: ResearchResult,
    data: BugJobData,
    isFrontend: boolean,
    fileContents: Map<string, string>,
  ): string {
    const stack = isFrontend
      ? `React 19, Vite 7, TanStack Router/Query, Zustand, shadcn/ui, Tailwind CSS 4, i18next, Vitest.
Imports usam @/ como alias para src/. Componentes UI ficam em @/components/ui/ (shadcn). Toasts usam sonner. Formulários usam React Hook Form + Zod. API usa axios via @/lib/api.ts. Auth via Zustand em @/stores/auth-store.ts.`
      : `NestJS 11, TypeORM 0.3, MySQL, BullMQ, Valkey/Redis, Jest.
Usa NestJS DI, TypeORM repositories, class-validator para DTOs, Guards para auth.`;

    return `
Você é um especialista sênior em ${isFrontend ? 'React e frontend moderno' : 'NestJS e backend Node.js'}.
Outro agente já pesquisou e diagnosticou o bug. Seu trabalho é definir as edições exatas para CORRIGIR o código.

STACK DO PROJETO:
${stack}

PESQUISA DO BUG:
Arquivos envolvidos: ${research.files.join(', ')}
Causa raiz: ${research.rootCause}
Abordagem sugerida: ${research.suggestedApproach}

RELATO ORIGINAL:
${data.description}

CÓDIGO ATUAL DOS ARQUIVOS:
${this.formatFiles(fileContents)}

REGRAS OBRIGATÓRIAS:
1. Corrija APENAS o bug identificado — não refatore nada além do necessário
2. Respeite os padrões do projeto: ${isFrontend ? 'imports com @/, shadcn/ui, i18next' : 'TypeORM repositories, NestJS DI, class-validator'}
3. Cada edit deve ter "search" com o trecho EXATO do código atual e "replace" com o código corrigido
4. O "search" deve ser único no arquivo — inclua contexto suficiente para não ser ambíguo
5. Prefira soluções já existentes no código — não reinvente

Responda SOMENTE com JSON válido, sem markdown:
{
  "summary": "fix(${data.service}): descrição curta em até 72 chars",
  "explanation": "explicação detalhada do que foi corrigido e por quê",
  "edits": [
    {
      "file": "caminho/relativo/arquivo.ts",
      "search": "trecho exato do código atual que será substituído",
      "replace": "código corrigido que substituirá o trecho"
    }
  ]
}
    `.trim();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private extractJson(output: string): any {
    const clean = output
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(
        `IA não retornou JSON válido.\nOutput: ${output.slice(0, 500)}`,
      );
    }

    return JSON.parse(match[0]);
  }
}
