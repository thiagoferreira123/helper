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
    const log = (msg: string) => {
      job.log(msg);
      this.logger.log(`[job ${job.id}] ${msg}`);
    };

    try {
      // 1. Preparar workspace
      log('Preparando workspace...');
      await job.updateProgress(5);
      await this.git.fetchAndReset();

      // 2. Criar branch isolada
      const branch = `fix/agent-${job.id}`;
      log(`Criando branch ${branch}`);
      await job.updateProgress(10);
      await this.git.createBranch(branch);

      // 3. Análise do bug
      log('Analisando bug com Claude Code...');
      await job.updateProgress(20);
      const analysis = await this.agent.analyze(data, log);
      log(
        `Bug localizado: ${analysis.file}:${analysis.line} (confiança ${analysis.confidence}%)`,
      );
      await job.updateProgress(40);

      // 4. Aplicar correção
      log('Aplicando correção...');
      const fix = await this.agent.applyFix(analysis, data, log);
      log(`Fix: ${fix.summary}`);
      await job.updateProgress(60);

      // 5. Rodar testes
      log('Rodando testes...');
      let testResult = await this.agent.runTests(log);
      await job.updateProgress(75);

      // 5b. Se falhou, tenta corrigir
      if (!testResult.passed) {
        log(
          `${testResult.failures} teste(s) falharam. Tentando corrigir...`,
        );
        await this.agent.fixFailingTests(testResult, log);
        testResult = await this.agent.runTests(log);

        if (!testResult.passed) {
          throw new Error(
            `Testes continuam falhando. Falhas: ${testResult.failures}`,
          );
        }
        log('Testes corrigidos com sucesso.');
      } else {
        log('Todos os testes passaram.');
      }
      await job.updateProgress(85);

      // 6. Commit e push
      log('Fazendo commit e push...');
      await this.git.commitAndPush(branch, fix.summary);
      await job.updateProgress(90);

      // 7. Merge na homologacao e abrir PR
      log('Fazendo merge na homologacao...');
      await this.git.mergeToHomologacao(branch);

      log('Abrindo Pull Request...');
      const prUrl = await this.github.openPR({
        branch: 'homologacao',
        title: fix.summary,
        body: [
          `## Bug Report`,
          `- **Feature:** ${data.service}`,
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
        ].join('\n'),
      });
      await job.updateProgress(100);

      // 8. Limpar branch temporária
      await this.git.deleteBranch(branch);

      log(`PR aberta: ${prUrl}`);
      return { prUrl, summary: fix.summary };
    } catch (err) {
      log(`ERRO: ${err.message}`);
      try {
        await this.git.fetchAndReset();
      } catch {}
      throw err;
    }
  }
}
