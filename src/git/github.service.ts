import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';

interface OpenPRParams {
  branch: string;
  title: string;
  body: string;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;

  constructor(private readonly config: ConfigService) {
    this.octokit = new Octokit({
      auth: this.config.getOrThrow('GITHUB_TOKEN'),
    });
    this.owner = this.config.getOrThrow('GITHUB_OWNER');
    this.repo = this.config.getOrThrow('GITHUB_REPO');
  }

  async openPR({ branch, title, body }: OpenPRParams): Promise<string> {
    const { data } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      head: branch,
      base: 'develop',
    });

    this.logger.log(`PR #${data.number} criada: ${data.html_url}`);
    return data.html_url;
  }
}
