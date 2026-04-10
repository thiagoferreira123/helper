import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  private readonly repoPath: string;

  constructor(private readonly config: ConfigService) {
    this.repoPath = this.config.getOrThrow('REPO_PATH');
  }

  private run(cmd: string): string {
    this.logger.debug(`git: ${cmd}`);
    return execSync(cmd, {
      cwd: this.repoPath,
      encoding: 'utf-8',
      timeout: 60_000,
    }).trim();
  }

  async fetchAndReset(): Promise<void> {
    this.run('git fetch origin');
    this.run('git checkout homologacao');
    this.run('git reset --hard origin/homologacao');
    this.run('git clean -fd');
  }

  async createBranch(name: string): Promise<void> {
    this.run(`git checkout -b ${name}`);
  }

  async commitAndPush(branch: string, message: string): Promise<void> {
    this.run('git add -A');
    const safeMsg = message.replace(/"/g, '\\"');
    this.run(`git commit -m "${safeMsg}"`);
    this.run(`git push origin ${branch}`);
  }

  async mergeToHomologacao(branch: string): Promise<void> {
    this.run('git checkout homologacao');
    this.run(`git merge ${branch} --no-ff -m "merge: ${branch}"`);
    this.run('git push origin homologacao');
  }

  async deleteBranch(branch: string): Promise<void> {
    try {
      this.run(`git branch -d ${branch}`);
    } catch {}
    try {
      this.run(`git push origin --delete ${branch}`);
    } catch {}
  }
}
