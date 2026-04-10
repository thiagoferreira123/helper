import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { BugProcessor } from './bug.processor';
import { AgentModule } from '../agent/agent.module';
import { GitModule } from '../git/git.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'bug-jobs',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    }),
    AgentModule,
    GitModule,
  ],
  providers: [QueueService, BugProcessor],
  exports: [QueueService],
})
export class QueueModule {}
