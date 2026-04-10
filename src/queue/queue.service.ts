import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';

export interface BugJobData {
  description: string;
  severity: 'critico' | 'alto' | 'medio' | 'baixo';
  service: string;
  reportedBy: string;
  imageBase64?: string;
  imageMimeType?: string;
  source: 'api' | 'slack';
  timestamp: number;
  target?: 'main' | 'homologacao';
}

const PRIORITY_MAP: Record<string, number> = {
  critico: 1,
  alto: 2,
  medio: 3,
  baixo: 4,
};

@Injectable()
export class QueueService {
  constructor(@InjectQueue('bug-jobs') private readonly queue: Queue) {}

  async enqueue(data: BugJobData): Promise<Job> {
    return this.queue.add('fix-bug', data, {
      priority: PRIORITY_MAP[data.severity] ?? 3,
    });
  }

  async getJob(jobId: string): Promise<Job | undefined> {
    return this.queue.getJob(jobId);
  }

  async getStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  }
}
