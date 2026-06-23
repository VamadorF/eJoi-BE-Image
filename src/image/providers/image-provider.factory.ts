import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ImageGenerationInput,
  ImageProvider,
  ImageProviderName,
} from './image-provider.types';
import { OpenAiImageProvider } from './openai-image.provider';
import { SegmindImageProvider } from './segmind-image.provider';
import { FluxImageProvider } from './flux-image.provider';
import { AnillustriousImageProvider } from './anillustrious-image.provider';
import { AnimePromptDetector } from './anime-prompt.detector';

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
    private readonly animeDetector: AnimePromptDetector,
  ) {}

  /**
   * Resuelve el provider según el estilo del prompt:
   * - Prompts anime → Anillustrious (modelo dedicado).
   * - Resto → provider configurado vía IMAGE_PROVIDER (getProvider()).
   */
  getProviderForInput(input: ImageGenerationInput): ImageProvider {
    if (this.animeDetector.isAnimePrompt(input.prompt)) {
      this.logger.log('Prompt anime detectado: usando provider Anillustrious');
      return this.anillustriousProvider;
    }
    return this.getProvider();
  }

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
