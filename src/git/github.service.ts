import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';

interface OpenPRParams {
  repo: string; // 'front-new' ou 'back'
  branch: string;
  title: string;
  body: string;
}

interface DiscordNotifyParams {
  prUrl: string;
  title: string;
  repo: string;
  service: string;
  severity: string;
  reportedBy: string;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly discordWebhookUrl: string;

  constructor(private readonly config: ConfigService) {
    this.octokit = new Octokit({
      auth: this.config.get('GITHUB_TOKEN', ''),
    });
    this.owner = this.config.get('GITHUB_OWNER', 'thiagoferreira123');
    this.discordWebhookUrl = this.config.get(
      'DISCORD_WEBHOOK_URL',
      'https://discord.com/api/webhooks/1492088594595184660/xjlJ4KRxzilFkEUaf54O622_V8Zsj7Yy3bcqsibKtgtHAIsEVZ3rlG4KRHfp9Yq84nhj',
    );
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

  async notifyDiscord(params: DiscordNotifyParams): Promise<void> {
    if (!this.discordWebhookUrl) return;

    const severityEmoji: Record<string, string> = {
      critico: '\u{1F534}',
      alto: '\u{1F7E0}',
      medio: '\u{1F7E1}',
      baixo: '\u{1F7E2}',
    };

    const emoji = severityEmoji[params.severity] || '\u{1F41B}';

    const payload = {
      embeds: [
        {
          title: `${emoji} Bug Fix PR Aberta`,
          description: params.title,
          color: 0x5865f2,
          fields: [
            { name: 'Repo', value: params.repo, inline: true },
            { name: 'Feature', value: params.service, inline: true },
            { name: 'Severidade', value: params.severity, inline: true },
            { name: 'Reportado por', value: params.reportedBy, inline: true },
            { name: 'PR', value: `[Abrir no GitHub](${params.prUrl})` },
          ],
          footer: { text: 'Bug Agent \u{1F916}' },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    try {
      const res = await fetch(this.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        this.logger.warn(`Discord webhook falhou: ${res.status} ${res.statusText}`);
      } else {
        this.logger.log('Notificacao Discord enviada');
      }
    } catch (err) {
      this.logger.warn(`Discord webhook erro: ${err.message}`);
    }
  }
}
