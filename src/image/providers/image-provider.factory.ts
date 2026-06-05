import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImageProvider, ImageProviderName } from './image-provider.types';
import { OpenAiImageProvider } from './openai-image.provider';
import { SegmindImageProvider } from './segmind-image.provider';

const VALID_PROVIDERS: ImageProviderName[] = ['openai', 'segmind'];

@Injectable()
export class ImageProviderFactory {
  private readonly logger = new Logger(ImageProviderFactory.name);

  constructor(
    private readonly config: ConfigService,
    private readonly openAiProvider: OpenAiImageProvider,
    private readonly segmindProvider: SegmindImageProvider,
  ) {}

  /** Provider principal según IMAGE_PROVIDER (default: openai). */
  getProvider(): ImageProvider {
    const configured = (this.config.get<string>('IMAGE_PROVIDER') ?? 'openai')
      .trim()
      .toLowerCase();

    if (!VALID_PROVIDERS.includes(configured as ImageProviderName)) {
      this.logger.warn(
        `IMAGE_PROVIDER inválido "${configured}". Usando 'openai' por defecto.`,
      );
      return this.openAiProvider;
    }

    return configured === 'segmind' ? this.segmindProvider : this.openAiProvider;
  }

  /** Provider de respaldo para el fallback (OpenAI). */
  getFallbackProvider(): ImageProvider {
    return this.openAiProvider;
  }

  /** Indica si el fallback entre providers está habilitado. */
  isFallbackEnabled(): boolean {
    return (
      (this.config.get<string>('ENABLE_IMAGE_PROVIDER_FALLBACK') ?? 'false')
        .trim()
        .toLowerCase() === 'true'
    );
  }
}
