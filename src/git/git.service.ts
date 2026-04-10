import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);

  private run(cmd: string, repoPath: string): string {
    this.logger.debug(`git [${repoPath}]: ${cmd}`);
    return execSync(cmd, {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 60_000,
    }).trim();
  }

  async fetchAndReset(repoPath: string): Promise<void> {
    // Aborta qualquer merge/rebase pendente antes de tudo
    try { this.run('git merge --abort', repoPath); } catch {}
    try { this.run('git rebase --abort', repoPath); } catch {}
    this.run('git reset --hard', repoPath);
    this.run('git fetch origin', repoPath);
    this.run('git checkout main', repoPath);
    this.run('git reset --hard origin/main', repoPath);
    this.run('git clean -fd', repoPath);
  }

  async createBranch(repoPath: string, name: string): Promise<void> {
    // Remove branch local se já existir (retry de job anterior)
    try { this.run(`git branch -D ${name}`, repoPath); } catch {}
    this.run(`git checkout -b ${name}`, repoPath);
  }

  async commitAndPush(repoPath: string, branch: string, message: string): Promise<void> {
    this.run('git add -A', repoPath);
    const safeMsg = message.replace(/"/g, '\\"');
    this.run(`git commit -m "${safeMsg}"`, repoPath);
    this.run(`git push origin ${branch}`, repoPath);
  }

  async mergeIntoBranch(repoPath: string, sourceBranch: string, targetBranch: string): Promise<void> {
    // Garante estado limpo e atualizado do target
    this.run('git fetch origin', repoPath);
    try {
      this.run(`git checkout ${targetBranch}`, repoPath);
      this.run(`git reset --hard origin/${targetBranch}`, repoPath);
    } catch {
      // Se não existe localmente, cria a partir de origin ou main
      try {
        this.run(`git checkout -b ${targetBranch} origin/${targetBranch}`, repoPath);
      } catch {
        this.run('git checkout main', repoPath);
        this.run(`git checkout -b ${targetBranch}`, repoPath);
      }
    }
    try {
      this.run(`git merge ${sourceBranch} --no-edit`, repoPath);
    } catch {
      // Conflito: resolve a favor do fix branch
      this.logger.warn(`Conflito no merge, resolvendo com -X theirs`);
      this.run('git merge --abort', repoPath);
      this.run(`git merge ${sourceBranch} --no-edit -X theirs`, repoPath);
    }
    this.run(`git push origin ${targetBranch}`, repoPath);
    this.logger.log(`Branch ${sourceBranch} mergeada em ${targetBranch}`);
  }

  async deleteBranch(repoPath: string, branch: string): Promise<void> {
    try { this.run(`git branch -d ${branch}`, repoPath); } catch {}
    try { this.run(`git push origin --delete ${branch}`, repoPath); } catch {}
  }
}
