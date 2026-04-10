import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';

interface OpenPRParams {
  repo: string; // 'front-new' ou 'back'
  branch: string;
  title: string;
  body: string;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly octokit: Octokit;
  private readonly owner: string;

  constructor(private readonly config: ConfigService) {
    this.octokit = new Octokit({
      auth: this.config.get('GITHUB_TOKEN', ''),
    });
    this.owner = this.config.get('GITHUB_OWNER', 'thiagoferreira123');
  }

  async openPR({ repo, branch, title, body }: OpenPRParams): Promise<string> {
    const { data } = await this.octokit.pulls.create({
      owner: this.owner,
      repo,
      title,
      body,
      head: branch,
      base: 'main',
    });

    this.logger.log(`PR #${data.number} criada: ${data.html_url}`);
    return data.html_url;
  }
}
