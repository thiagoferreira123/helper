import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BugJobData } from './queue.service';
import { AgentService } from '../agent/agent.service';
import { GitService } from '../git/git.service';
import { GithubService } from '../git/github.service';

@Processor('bug-jobs', { concurrency: 1 })
export class BugProcessor extends WorkerHost {
  private readonly logger = new Logger(BugProcessor.name);

  constructor(
    private readonly agent: AgentService,
    private readonly git: GitService,
    private readonly github: GithubService,
  ) {
    super();
  }

  async process(job: Job<BugJobData>): Promise<any> {
    const data = job.data;
    const target = data.target || 'main';
    const repoPath = this.agent.getRepoPath(data.service);
    const repoName = repoPath.includes('front-new') ? 'frontend-v3' : 'back-dietsystem-v2-nestjs';
    const log = (msg: string) => {
      job.log(msg);
      this.logger.log(`[job ${job.id}] ${msg}`);
    };

    try {
      // Preparar workspace + branch
      log(`Preparando workspace (${repoName})...`);
      await job.updateProgress(5);
      await this.git.fetchAndReset(repoPath);

      const branch = `fix/agent-${job.id}`;
      log(`Criando branch ${branch}`);
      await this.git.createBranch(repoPath, branch);
      await job.updateProgress(10);

      // Etapa 1: Triagem + Pesquisa profunda (3 chamadas IA)
      log('Triagem e pesquisa profunda...');
      const research = await this.agent.research(data, log);
      log(`Causa raiz: ${research.rootCause}`);
      log(`Arquivos a editar: ${research.files.join(', ')}`);
      await job.updateProgress(50);

      // Etapa 2: Correção cirúrgica
      log('Aplicando correção cirúrgica...');
      const fix = await this.agent.fix(research, data, log);
      log(`Fix: ${fix.summary}`);
      await job.updateProgress(80);

      // Commit e push
      log('Commit e push...');
      await this.git.commitAndPush(repoPath, branch, fix.summary);
      await job.updateProgress(90);

      // Homologacao: merge direto
      if (target === 'homologacao') {
        log('Mergeando direto em homologacao...');
        await this.git.mergeIntoBranch(repoPath, branch, 'homologacao');
      }

      // Sempre abre PR na main
      log('Abrindo Pull Request na main...');
      const prBody = [
        `## Bug Report`,
        `- **Feature:** ${data.service}`,
        `- **Repo:** ${repoName}`,
        `- **Severidade:** ${data.severity}`,
        `- **Reportado por:** ${data.reportedBy}`,
        `- **Descrição:** ${data.description}`,
        '',
        `## Pesquisa`,
        `- **Arquivos:** ${research.files.map(f => `\`${f}\``).join(', ')}`,
        `- **Causa raiz:** ${research.rootCause}`,
        `- **Abordagem:** ${research.suggestedApproach}`,
        research.references.length ? `- **Refs:** ${research.references.join(', ')}` : '',
        '',
        `## Correção`,
        fix.explanation,
        '',
        target === 'homologacao' ? `> Já mergeado em homologacao. Correção automática pelo Bug Agent (job #${job.id})` : `> Correção automática pelo Bug Agent (job #${job.id})`,
      ].join('\n');

      const prUrl = await this.github.openPR({
        repo: repoName,
        branch,
        title: fix.summary,
        body: prBody,
      });

      log('Notificando Discord...');
      await this.github.notifyDiscord({
        prUrl,
        title: fix.summary,
        repo: repoName,
        service: data.service,
        severity: data.severity,
        reportedBy: data.reportedBy,
        target,
        analysis: { file: research.files[0] || '', line: 0, rootCause: research.rootCause, confidence: 0 },
        explanation: fix.explanation,
      });
      await job.updateProgress(100);

      log(`PR aberta: ${prUrl}`);
      return { prUrl, summary: fix.summary, target };
    } catch (err) {
      log(`ERRO: ${err.message}`);
      try { await this.git.fetchAndReset(repoPath); } catch {}
      throw err;
    }
  }
}
