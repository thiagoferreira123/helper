import { Module } from '@nestjs/common';
import { GitService } from './git.service';
import { GithubService } from './github.service';

@Module({
  providers: [GitService, GithubService],
  exports: [GitService, GithubService],
})
export class GitModule {}
