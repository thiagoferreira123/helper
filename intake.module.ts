import { Module } from '@nestjs/common'
import { IntakeController } from './intake.controller'
import { QueueModule } from '../queue/queue.module'

@Module({
  imports: [QueueModule],
  controllers: [IntakeController],
})
export class IntakeModule {}
