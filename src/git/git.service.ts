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
    this.run('git fetch origin', repoPath);
    this.run('git checkout main', repoPath);
    this.run('git reset --hard origin/main', repoPath);
    this.run('git clean -fd', repoPath);
  }

  async createBranch(repoPath: string, name: string): Promise<void> {
    this.run(`git checkout -b ${name}`, repoPath);
  }

  async commitAndPush(repoPath: string, branch: string, message: string): Promise<void> {
    this.run('git add -A', repoPath);
    const safeMsg = message.replace(/"/g, '\\"');
    this.run(`git commit -m "${safeMsg}"`, repoPath);
    this.run(`git push origin ${branch}`, repoPath);
  }

  async deleteBranch(repoPath: string, branch: string): Promise<void> {
    try { this.run(`git branch -d ${branch}`, repoPath); } catch {}
    try { this.run(`git push origin --delete ${branch}`, repoPath); } catch {}
  }
}
