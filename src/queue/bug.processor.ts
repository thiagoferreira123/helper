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
    const repoName = repoPath.includes('front-new') ? 'front-new' : 'back';
    const log = (msg: string) => {
      job.log(msg);
      this.logger.log(`[job ${job.id}] ${msg}`);
    };

    try {
      // 1. Preparar workspace
      log(`Preparando workspace (${repoName})...`);
      await job.updateProgress(5);
      await this.git.fetchAndReset(repoPath);

      // 2. Criar branch isolada
      const branch = `fix/agent-${job.id}`;
      log(`Criando branch ${branch}`);
      await job.updateProgress(10);
      await this.git.createBranch(repoPath, branch);

      // 3. Análise
      log('Analisando bug com Claude Code...');
      await job.updateProgress(20);
      const analysis = await this.agent.analyze(data, log);
      log(`Bug localizado: ${analysis.file}:${analysis.line} (${analysis.confidence}%)`);
      await job.updateProgress(40);

      // 4. Correção
      log('Aplicando correção...');
      const fix = await this.agent.applyFix(analysis, data, log);
      log(`Fix: ${fix.summary}`);
      await job.updateProgress(60);

      // 5. Testes
      log('Rodando testes...');
      let testResult = await this.agent.runTests(repoPath, log);
      await job.updateProgress(75);

      if (!testResult.passed) {
        log(`${testResult.failures} teste(s) falharam. Corrigindo...`);
        await this.agent.fixFailingTests(testResult, repoPath, log);
        testResult = await this.agent.runTests(repoPath, log);
        if (!testResult.passed) {
          throw new Error(`Testes continuam falhando. Falhas: ${testResult.failures}`);
        }
        log('Testes corrigidos.');
      } else {
        log('Todos os testes passaram.');
      }
      await job.updateProgress(85);

      // 6. Commit e push
      log('Commit e push...');
      await this.git.commitAndPush(repoPath, branch, fix.summary);
      await job.updateProgress(90);

      if (target === 'homologacao') {
        // Homologação: merge direto na branch homologacao
        log('Mergeando direto em homologacao...');
        await this.git.mergeIntoBranch(repoPath, branch, 'homologacao');
        await job.updateProgress(100);

        log('Push direto em homologacao concluído.');
        return { summary: fix.summary, target: 'homologacao' };
      }

      // Main: abrir PR + notificar Discord
      log('Abrindo Pull Request na main...');
      const prBody = [
        `## Bug Report`,
        `- **Feature:** ${data.service}`,
        `- **Repo:** ${repoName}`,
        `- **Severidade:** ${data.severity}`,
        `- **Reportado por:** ${data.reportedBy}`,
        `- **Descrição:** ${data.description}`,
        '',
        `## Correção`,
        fix.explanation,
        '',
        `## Análise`,
        `- **Arquivo:** \`${analysis.file}:${analysis.line}\``,
        `- **Causa raiz:** ${analysis.rootCause}`,
        `- **Confiança:** ${analysis.confidence}%`,
        '',
        `> Correção automática pelo Bug Agent (job #${job.id})`,
      ].join('\n');

      const prUrl = await this.github.openPR({
        repo: repoName,
        branch,
        title: fix.summary,
        body: prBody,
      });
      await job.updateProgress(95);

      // Notificar Discord
      log('Notificando Discord...');
      await this.github.notifyDiscord({
        prUrl,
        title: fix.summary,
        repo: repoName,
        service: data.service,
        severity: data.severity,
        reportedBy: data.reportedBy,
      });
      await job.updateProgress(100);

      log(`PR aberta: ${prUrl}`);
      return { prUrl, summary: fix.summary, target: 'main' };
    } catch (err) {
      log(`ERRO: ${err.message}`);
      try { await this.git.fetchAndReset(repoPath); } catch {}
      throw err;
    }
  }
}
