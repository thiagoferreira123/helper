import {
  Controller,
  Post,
  Body,
  BadRequestException,
  Logger,
  Get,
  Param,
} from '@nestjs/common';
import { QueueService, BugJobData } from '../queue/queue.service';

interface BugReportDto {
  description: string;
  severity: 'critico' | 'alto' | 'medio' | 'baixo';
  service: string;
  reportedBy: string;
  imageBase64?: string;
  imageMimeType?: string;
}

@Controller('bugs')
export class IntakeController {
  private readonly logger = new Logger(IntakeController.name);

  constructor(private readonly queueService: QueueService) {}

  @Post()
  async report(@Body() body: BugReportDto) {
    if (!body.description?.trim()) {
      throw new BadRequestException('description é obrigatório');
    }
    if (!body.service) {
      throw new BadRequestException('service é obrigatório');
    }
    if (!body.reportedBy) {
      throw new BadRequestException('reportedBy é obrigatório');
    }

    const validSeverities = ['critico', 'alto', 'medio', 'baixo'];
    if (!validSeverities.includes(body.severity)) {
      throw new BadRequestException('severity inválido');
    }

    const jobData: BugJobData = {
      description: body.description.trim(),
      severity: body.severity,
      service: body.service,
      reportedBy: body.reportedBy,
      imageBase64: body.imageBase64,
      imageMimeType: body.imageMimeType,
      source: 'api',
      timestamp: Date.now(),
    };

    const job = await this.queueService.enqueue(jobData);

    this.logger.log(
      `Bug reportado — job ${job.id} — ${body.severity}/${body.service} por ${body.reportedBy}`,
    );

    return {
      jobId: String(job.id),
      message: 'Bug enfileirado. PR será aberta em breve.',
    };
  }

  @Get(':jobId/status')
  async status(@Param('jobId') jobId: string) {
    const job = await this.queueService.getJob(jobId);
    if (!job) return { status: 'not_found' };

    const state = await job.getState();
    const progress = job.progress;
    const logs = await job.log('') as any;

    return {
      jobId,
      state,
      progress: typeof progress === 'number' ? progress : 0,
      logs: Array.isArray(logs?.logs) ? logs.logs.slice(-20) : [],
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    };
  }

  @Get('stats')
  async stats() {
    return this.queueService.getStats();
  }
}
