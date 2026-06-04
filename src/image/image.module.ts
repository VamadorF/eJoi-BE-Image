import { Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { ImageController } from './image.controller';
import { StorageModule } from '../storage/storage.module';
import { OpenAiImageProvider } from './providers/openai-image.provider';
import { SegmindImageProvider } from './providers/segmind-image.provider';
import { ImageProviderFactory } from './providers/image-provider.factory';


@Module({
  imports: [StorageModule],
  providers: [
    ImageService,
    OpenAiImageProvider,
    SegmindImageProvider,
    ImageProviderFactory,
  ],
  controllers: [ImageController],
})
export class ImageModule {}
