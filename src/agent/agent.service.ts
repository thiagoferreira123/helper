import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  statSync,
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

  // ═══════════════════════════════════════════════════════════════════════
  // ETAPA 1: TRIAGEM — IA vê nomes dos arquivos e escolhe quais ler
  // ═══════════════════════════════════════════════════════════════════════

  async research(
    data: BugJobData,
    onLog: (log: string) => void,
  ): Promise<ResearchResult> {
    const repoPath = this.getRepoPath(data.service);
    const isFrontend = FRONTEND_FEATURES.has(data.service);

    // Passo 1: Listar arquivos (só nomes + tamanho)
    onLog('Listando arquivos da feature...');
    const fileList = this.listFeatureFiles(repoPath, data.service);
    onLog(`${fileList.length} arquivos encontrados`);

    // Passo 2: IA escolhe quais arquivos ler (máx 8)
    onLog('Triagem: IA escolhendo arquivos relevantes (gpt-5.4-pro)...');
    const triagePrompt = this.buildTriagePrompt(data, isFrontend, fileList);
    const triageOutput = await this.callOpenAI(triagePrompt, data, 'gpt-5.4-pro');
    const triage = this.extractJson(triageOutput);
    const filesToRead: string[] = (triage.files || []).slice(0, 10);
    onLog(`Triagem: ${filesToRead.length} arquivos selecionados: ${filesToRead.join(', ')}`);

    // Passo 3: Ler arquivos selecionados e analisar a fundo
    onLog('Pesquisa profunda nos arquivos selecionados...');
    const fileContents = this.readSpecificFiles(repoPath, filesToRead);
    const researchPrompt = this.buildResearchPrompt(data, isFrontend, fileContents);
    onLog(`Consultando gpt-5.4-pro (pesquisa, ${researchPrompt.length} chars)...`);
    const researchOutput = await this.callOpenAI(researchPrompt, data, 'gpt-5.4-pro');
    return this.extractJson(researchOutput);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ETAPA 2: CORREÇÃO — edits cirúrgicos nos arquivos identificados
  // ═══════════════════════════════════════════════════════════════════════

  async fix(
    research: ResearchResult,
    data: BugJobData,
    onLog: (log: string) => void,
  ): Promise<FixResult> {
    const repoPath = this.getRepoPath(data.service);
    const isFrontend = FRONTEND_FEATURES.has(data.service);

    onLog('Lendo arquivos para correção...');
    const fileContents = this.readSpecificFiles(repoPath, research.files);

    const prompt = this.buildFixPrompt(research, data, isFrontend, fileContents);
    onLog(`Consultando GPT-5.4 (correção, ${prompt.length} chars)...`);
    const output = await this.callOpenAI(prompt, null);
    const result = this.extractJson(output);

    // Aplicar edits
    let editCount = 0;
    if (result.edits && Array.isArray(result.edits)) {
      for (const edit of result.edits as FileEdit[]) {
        const filePath = join(repoPath, edit.file);
        if (!existsSync(filePath)) {
          onLog(`AVISO: arquivo não encontrado: ${edit.file}`);
          continue;
        }
        let content = readFileSync(filePath, 'utf-8');
        if (!content.includes(edit.search)) {
          onLog(`AVISO: trecho não encontrado em ${edit.file} (${edit.search.slice(0, 60)}...)`);
          continue;
        }
        content = content.replace(edit.search, edit.replace);
        writeFileSync(filePath, content);
        editCount++;
        onLog(`Editado: ${edit.file}`);
      }
    }

    if (editCount === 0) {
      throw new Error('Nenhum edit foi aplicado — a IA não gerou edits válidos');
    }

    return { summary: result.summary, explanation: result.explanation };
  }

  // ─── OpenAI REST API ──────────────────────────────────────────────────

  private async callOpenAI(
    prompt: string,
    data: BugJobData | null,
    model: 'gpt-5.4' | 'gpt-5.4-pro' = 'gpt-5.4',
  ): Promise<string> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');

    const content: any[] = [];

    if (data?.imageBase64) {
      content.push({
        type: 'input_image',
        image_url: `data:${data.imageMimeType || 'image/png'};base64,${data.imageBase64}`,
      });
    }

    content.push({ type: 'input_text', text: prompt });

    this.logger.debug(`Chamando OpenAI API (${model}, ${prompt.length} chars, imagem: ${!!data?.imageBase64})`);

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [{ role: 'user', content }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${errBody.slice(0, 500)}`);
    }

    const json = await res.json();

    // gpt-5.4-pro retorna reasoning + message; gpt-5.4 retorna só message
    let text: string | undefined;
    for (const block of json.output || []) {
      if (block.type === 'message' && block.content?.[0]?.text) {
        text = block.content[0].text;
        break;
      }
    }
    if (!text) {
      throw new Error(`OpenAI retornou resposta vazia: ${JSON.stringify(json).slice(0, 500)}`);
    }

    this.logger.debug(`OpenAI respondeu (${model}, ${text.length} chars)`);
    return text;
  }

  // ─── Leitura de arquivos ──────────────────────────────────────────────

  /** Lista nomes + tamanho dos arquivos da feature (sem conteúdo) */
  private listFeatureFiles(repoPath: string, service: string): string[] {
    const files: string[] = [];
    const featureDir = join(repoPath, `src/features/${service}`);
    this.walkDirNames(featureDir, repoPath, files, 80);

    // Adicionar arquivos compartilhados comuns
    const shared = [
      'src/lib/api.ts',
      'src/lib/utils.ts',
      'src/stores/auth-store.ts',
      'src/hooks/',
      'src/components/ui/',
    ];
    for (const s of shared) {
      const full = join(repoPath, s);
      if (existsSync(full)) {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          this.walkDirNames(full, repoPath, files, 80);
        } else {
          const rel = relative(repoPath, full).replace(/\\/g, '/');
          const size = Math.round(stat.size / 1024);
          files.push(`${rel} (${size}kb)`);
        }
      }
    }
    return files;
  }

  /** Coleta nomes de arquivos recursivamente */
  private walkDirNames(
    dir: string,
    repoPath: string,
    files: string[],
    maxFiles: number,
    depth = 0,
  ): void {
    if (depth > 5 || files.length >= maxFiles || !existsSync(dir)) return;
    let entries: any[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as any[];
    } catch { return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
        this.walkDirNames(full, repoPath, files, maxFiles, depth + 1);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const rel = relative(repoPath, full).replace(/\\/g, '/');
        try {
          const size = Math.round(statSync(full).size / 1024);
          files.push(`${rel} (${size}kb)`);
        } catch {}
      }
    }
  }

  /** Lê arquivos específicos por caminho relativo */
  private readSpecificFiles(repoPath: string, filePaths: string[]): Map<string, string> {
    const files = new Map<string, string>();
    for (const f of filePaths) {
      // Remove sufixo de tamanho se presente (ex: "path.ts (5kb)" → "path.ts")
      const cleanPath = f.replace(/\s*\(\d+kb\)$/, '');
      const full = join(repoPath, cleanPath);
      if (existsSync(full)) {
        try {
          const content = readFileSync(full, 'utf-8');
          files.set(cleanPath, content);
        } catch {}
      }
    }
    return files;
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

  private buildTriagePrompt(
    data: BugJobData,
    isFrontend: boolean,
    fileList: string[],
  ): string {
    const stack = isFrontend
      ? `React 19, Vite 7, TanStack Router/Query, Zustand, shadcn/ui, Tailwind CSS 4, i18next, Vitest.
Estrutura: src/features/<nome>/ com componentes, hooks, api/, data/ (schemas, types).`
      : `NestJS 11, TypeORM 0.3, MySQL, BullMQ, Valkey/Redis, Jest.`;

    const featureMap = isFrontend ? getFeatureMapText(data.service) : '';

    return `
Você é um triador de bugs. Sua ÚNICA tarefa é escolher quais arquivos um pesquisador deve ler para investigar este bug.

STACK: ${stack}
${featureMap ? `\nMAPA: ${featureMap}\n` : ''}
BUG REPORTADO:
Feature: ${data.service}
Severidade: ${data.severity}
Reportado por: ${data.reportedBy}
Descrição: ${data.description}

ARQUIVOS DISPONÍVEIS:
${fileList.join('\n')}

REGRAS:
- Escolha entre 3 e 8 arquivos que são MAIS RELEVANTES para este bug específico
- Priorize: componentes de formulário/edição, hooks de mutação, schemas, tipos, API calls
- NÃO escolha arquivos de listagem/tabela se o bug é sobre edição/salvamento
- NÃO escolha arquivos de UI pura (ícones, badges) se o bug é de lógica
- Pense: "onde está o código que EXECUTA a ação que está falhando?"

Responda SOMENTE com JSON válido:
{
  "files": ["caminho/completo/arquivo1.ts", "caminho/completo/arquivo2.tsx"],
  "reasoning": "por que esses arquivos são relevantes para este bug"
}
    `.trim();
  }

  private buildResearchPrompt(
    data: BugJobData,
    isFrontend: boolean,
    fileContents: Map<string, string>,
  ): string {
    const stack = isFrontend
      ? `React 19, Vite 7, TanStack Router/Query, Zustand, shadcn/ui, Tailwind CSS 4, i18next, Vitest.
O frontend é organizado por features em src/features/<nome>/. Cada feature tem seus componentes, hooks e services.`
      : `NestJS 11, TypeORM 0.3, MySQL, BullMQ, Valkey/Redis, Jest.`;

    return `
Você é um pesquisador sênior de bugs. Analise o código abaixo e encontre a causa raiz EXATA do bug.

STACK DO PROJETO: ${stack}

BUG REPORTADO:
Feature: ${data.service}
Severidade: ${data.severity}
Reportado por: ${data.reportedBy}
Descrição: ${data.description}

CÓDIGO (leia CADA LINHA com atenção):
${this.formatFiles(fileContents)}

INSTRUÇÕES:
1. Leia TODO o código acima linha por linha
2. Trace o fluxo exato que o usuário percorre quando o bug acontece
3. Identifique a LINHA EXATA e a CONDIÇÃO que causa o problema
4. Não dê respostas genéricas — cite o código específico

Na sua análise, OBRIGATORIAMENTE:
- Cite trechos exatos do código que causam o bug (copie e cole)
- Explique o fluxo: "quando o usuário faz X, a função Y na linha Z faz W, mas deveria fazer V"
- Se o bug é sobre dados sendo perdidos, mostre ONDE os dados são sobrescritos/ignorados

Responda SOMENTE com JSON válido:
{
  "files": ["apenas os arquivos que REALMENTE precisam ser editados"],
  "rootCause": "Causa raiz ESPECÍFICA com citação de código. Ex: 'Na linha X de arquivo.ts, o useEffect sobrescreve phone com defaultValues que não inclui o valor existente do paciente. Trecho: const defaults = { phone: \"\" } — deveria usar patient.phone'",
  "suggestedApproach": "Passo a passo ESPECÍFICO da correção. Ex: '1. No arquivo X, mudar a linha Y de Z para W. 2. No arquivo A, adicionar campo B ao objeto C'",
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
Você é um cirurgião de código. Aplique a correção MÍNIMA e PRECISA para resolver este bug.

STACK: ${stack}

DIAGNÓSTICO CONFIRMADO:
Arquivos: ${research.files.join(', ')}
Causa raiz: ${research.rootCause}
Correção planejada: ${research.suggestedApproach}

RELATO DO USUÁRIO: ${data.description}

CÓDIGO ATUAL:
${this.formatFiles(fileContents)}

REGRAS ABSOLUTAS:
1. Corrija APENAS o que causa o bug — ZERO refatoração, ZERO mudanças cosméticas
2. Cada "search" DEVE ser uma cópia EXATA de um trecho do código acima (copie e cole, incluindo espaços e quebras de linha)
3. Cada "search" DEVE ser longo o suficiente para ser ÚNICO no arquivo (inclua 2-3 linhas de contexto acima e abaixo)
4. Se o bug é sobre dados sendo perdidos, a correção deve PRESERVAR os dados existentes
5. Não adicione features novas, não mude a UI, não adicione try/catch desnecessários
6. Teste mentalmente: "depois desta edição, o fluxo descrito no bug ainda acontece?" — se sim, sua correção está errada

Responda SOMENTE com JSON válido:
{
  "summary": "fix(${data.service}): descrição curta e específica do que foi corrigido",
  "explanation": "explicação técnica do que cada edit faz e por quê resolve o bug",
  "edits": [
    {
      "file": "caminho/relativo/arquivo.ts",
      "search": "cópia EXATA do trecho atual (múltiplas linhas, com contexto)",
      "replace": "código corrigido"
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
      throw new Error(`IA não retornou JSON válido.\nOutput: ${output.slice(0, 500)}`);
    }

    return JSON.parse(match[0]);
  }
}
