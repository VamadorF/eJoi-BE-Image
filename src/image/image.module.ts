import { Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { ImageController } from './image.controller';
import { StorageModule } from '../storage/storage.module';
import { LlmModule } from 'src/llm/llm.module';


@Module({
  imports: [StorageModule, LlmModule],
  providers: [ImageService],
  controllers: [ImageController]
})
export class ImageModule {}
