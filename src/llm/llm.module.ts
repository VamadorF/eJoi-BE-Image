import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller';
import { LlmService } from './llm.service';
import { StorageService } from 'src/storage/storage.service';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  controllers: [LlmController],
  providers: [LlmService],
  imports: [StorageModule],
})
export class LlmModule {}
