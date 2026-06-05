import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  ImageGenerationInput,
  ImageGenerationResult,
  ImageProvider,
  ImageProviderName,
} from './image-provider.types';

/**
 * OpenAI text-to-image provider.
 *
 * Mantiene la misma lógica que vivía en LlmService.generateImage para
 * no cambiar el comportamiento del flujo actual de OpenAI.
 */
@Injectable()
export class OpenAiImageProvider implements ImageProvider {
  readonly name: ImageProviderName = 'openai';

  private readonly logger = new Logger(OpenAiImageProvider.name);
  private readonly client: OpenAI;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY in environment');
    }
    this.client = new OpenAI({ apiKey });
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Image gen timeout')), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const prompt = (input.prompt ?? '').trim();
    if (!prompt) {
      throw new InternalServerErrorException('OpenAI: prompt vacío.');
    }

    const model = input.model ?? 'gpt-image-1-mini';
    const size = input.size ?? '1024x1024';
    const quality = input.quality ?? 'low';
    const outputFormat = input.outputFormat ?? 'png';
    const timeoutMs = input.timeoutMs ?? 30000;

    this.logger.log(
      `provider=openai model=${model} size=${size} quality=${quality} prompt="${prompt.slice(0, 60)}"`,
    );

    try {
      const result = await this.withTimeout(
        this.client.images.generate({
          model,
          prompt,
          size,
          quality,
          output_format: outputFormat,
        } as any),
        timeoutMs,
      );

      const b64 = result?.data?.[0]?.b64_json;
      if (!b64) {
        this.logger.warn('OpenAI image API returned empty b64_json');
        throw new Error('Empty image response');
      }

      return {
        b64,
        contentType: this.toContentType(outputFormat),
        model,
        provider: this.name,
        userId: input.userId,
        companionId: input.companionId,
        uuid: input.uuid,
      };
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const code = err?.code;
      const msg = typeof err?.message === 'string' ? err.message : 'unknown error';

      this.logger.error(
        `OpenAI image gen error: status=${status ?? 'n/a'} code=${code ?? 'n/a'} msg=${msg}`,
      );

      throw new InternalServerErrorException(
        'No pude generar la imagen en este momento. Por favor intenta nuevamente.',
      );
    }
  }

  private toContentType(outputFormat: 'png' | 'jpeg' | 'webp'): string {
    switch (outputFormat) {
      case 'jpeg':
        return 'image/jpeg';
      case 'webp':
        return 'image/webp';
      case 'png':
      default:
        return 'image/png';
    }
  }
}
