import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImageProvider, ImageProviderName } from './image-provider.types';
import { OpenAiImageProvider } from './openai-image.provider';
import { SegmindImageProvider } from './segmind-image.provider';
import { FluxImageProvider } from './flux-image.provider';
import { AnillustriousImageProvider } from './anillustrious-image.provider';
import { isAnimePrompt } from './anime-detection.util';

const VALID_PROVIDERS: ImageProviderName[] = ['openai', 'segmind', 'flux'];

@Injectable()
export class ImageProviderFactory {
  private readonly logger = new Logger(ImageProviderFactory.name);

  constructor(
    private readonly config: ConfigService,
    private readonly openAiProvider: OpenAiImageProvider,
    private readonly segmindProvider: SegmindImageProvider,
    private readonly fluxProvider: FluxImageProvider,
    private readonly anillustriousProvider: AnillustriousImageProvider,
  ) {}

  /**
   * Provider principal. Si el prompt describe claramente una imagen anime/manga,
   * se enruta al modelo dedicado Anillustrious; en caso contrario se resuelve
   * según IMAGE_PROVIDER (default: openai).
   */
  getProvider(prompt?: string): ImageProvider {
    if (prompt && isAnimePrompt(prompt)) {
      this.logger.log('Prompt anime detectado: usando provider Flux');
      return this.fluxProvider;
    }

    const configured = (this.config.get<string>('IMAGE_PROVIDER') ?? 'openai')
      .trim()
      .toLowerCase();

    if (!VALID_PROVIDERS.includes(configured as ImageProviderName)) {
      this.logger.warn(
        `IMAGE_PROVIDER inválido "${configured}". Usando 'openai' por defecto.`,
      );
      return this.openAiProvider;
    }

    if (configured === 'segmind') return this.segmindProvider;
    if (configured === 'flux') return this.fluxProvider;
    return this.openAiProvider;
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
