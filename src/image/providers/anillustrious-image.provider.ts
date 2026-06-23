import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ImageAspectRatio,
  ImageGenerationInput,
  ImageGenerationResult,
  ImageProvider,
  ImageProviderName,
} from './image-provider.types';

const REPLICATE_API = 'https://api.replicate.com/v1';
const ANILLUSTRIOUS_MODEL = 'aisha-ai-official/anillustrious-v4';
const MODEL_NAME = 'Anillustrious-v4';
const DEFAULT_STEPS = 16;
const DEFAULT_CFG_SCALE = 7;
const DEFAULT_SCHEDULER = 'LCMScheduler Karras';
const DEFAULT_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 1000;

/** aspect_ratio → dimensiones (SDXL ~1MP, dentro de 1..4096). */
const ASPECT_RATIO_DIMENSIONS: Record<
  ImageAspectRatio,
  { width: number; height: number }
> = {
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1152, height: 896 },
  '3:4': { width: 896, height: 1152 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
};
const DEFAULT_DIMENSIONS = ASPECT_RATIO_DIMENSIONS['1:1'];

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string[] | string;
  error?: string;
}

interface ReplicateModelResponse {
  latest_version: { id: string };
}

interface AnillustriousInput {
  model: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg_scale: number;
  scheduler: string;
  negative_prompt?: string;
}

/**
 * Proveedor dedicado para imágenes anime usando el modelo de Replicate
 * `aisha-ai-official/anillustrious-v4`. Comparte el mismo cliente (fetch +
 * REPLICATE_API_KEY) y el mismo flujo de predicción/polling que Flux.
 *
 * Solo se envían campos presentes en el schema oficial del modelo. Los toggles
 * avanzados (refiner, adetailer, upscale, pag, vae, seed, clip_skip, etc.) se
 * dejan en sus valores por defecto del modelo.
 */
@Injectable()
export class AnillustriousImageProvider implements ImageProvider {
  readonly name: ImageProviderName = 'anillustrious';

  private readonly logger = new Logger(AnillustriousImageProvider.name);
  private cachedVersion: string | null = null;
  private versionExpiry = 0;

  constructor(private readonly config: ConfigService) {}

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const apiKey = this.config.get<string>('REPLICATE_API_KEY');
    if (!apiKey) {
      this.logger.error('REPLICATE_API_KEY no está configurada');
      throw new InternalServerErrorException(
        'El proveedor Anillustrious no está configurado correctamente.',
      );
    }

    const prompt = (input.prompt ?? '').trim();
    if (!prompt) {
      throw new InternalServerErrorException('Anillustrious: prompt vacío.');
    }

    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const version = await this.resolveModelVersion(apiKey);

    const body = { version, input: this.buildInput(prompt, input) };

    this.logger.log(
      `provider=anillustrious model=${ANILLUSTRIOUS_MODEL} version=${version} prompt="${prompt.slice(0, 60)}"`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let prediction: ReplicatePrediction;
    try {
      prediction = await this.createPrediction(apiKey, body, controller);
    } catch (err: any) {
      this.logger.error(
        `Anillustrious create prediction error: ${err?.message ?? 'unknown'}`,
      );
      throw new InternalServerErrorException(
        'No pude generar la imagen en este momento. Por favor intenta nuevamente.',
      );
    } finally {
      clearTimeout(timeout);
    }

    try {
      const outputUrl = await this.pollPrediction(
        apiKey,
        prediction.id,
        controller,
      );
      const { b64, contentType } = await this.downloadAsBase64(outputUrl);
      return this.buildResult(b64, contentType, input);
    } catch (err: any) {
      this.logger.error(
        `Anillustrious polling/download error: ${err?.message ?? 'unknown'}`,
      );
      throw new InternalServerErrorException(
        'No pude generar la imagen en este momento. Por favor intenta nuevamente.',
      );
    }
  }

  private buildInput(
    prompt: string,
    input: ImageGenerationInput,
  ): AnillustriousInput {
    const { width, height } = this.resolveDimensions(input.aspectRatio);

    const steps =
      parseInt(
        this.config.get<string>('ANILLUSTRIOUS_STEPS') ?? String(DEFAULT_STEPS),
        10,
      ) || DEFAULT_STEPS;
    const cfgScale =
      parseFloat(
        this.config.get<string>('ANILLUSTRIOUS_CFG_SCALE') ??
          String(DEFAULT_CFG_SCALE),
      ) || DEFAULT_CFG_SCALE;
    const scheduler =
      this.config.get<string>('ANILLUSTRIOUS_SCHEDULER')?.trim() ||
      DEFAULT_SCHEDULER;

    const result: AnillustriousInput = {
      model: MODEL_NAME,
      prompt,
      width,
      height,
      steps,
      cfg_scale: cfgScale,
      scheduler,
    };

    // negative_prompt: input → env → omitido (deja el default del modelo).
    const negativePrompt = (
      input.negativePrompt ??
      this.config.get<string>('ANILLUSTRIOUS_NEGATIVE_PROMPT') ??
      ''
    ).trim();
    if (negativePrompt) {
      result.negative_prompt = negativePrompt;
    }

    return result;
  }

  private resolveDimensions(aspectRatio?: ImageAspectRatio): {
    width: number;
    height: number;
  } {
    if (aspectRatio && ASPECT_RATIO_DIMENSIONS[aspectRatio]) {
      return ASPECT_RATIO_DIMENSIONS[aspectRatio];
    }
    return DEFAULT_DIMENSIONS;
  }

  private async resolveModelVersion(apiKey: string): Promise<string> {
    if (this.cachedVersion && Date.now() < this.versionExpiry) {
      return this.cachedVersion;
    }

    try {
      const response = await fetch(
        `${REPLICATE_API}/models/${ANILLUSTRIOUS_MODEL}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        this.logger.error(
          `Anillustrious resolve model failed: status=${response.status} detail=${detail}`,
        );
        throw new Error(`Replicate model lookup failed: ${response.status}`);
      }

      const modelData = (await response.json()) as ReplicateModelResponse;
      const version = modelData.latest_version?.id;

      if (!version) {
        throw new Error(
          'No se encontró versión del modelo Anillustrious en Replicate',
        );
      }

      this.cachedVersion = version;
      this.versionExpiry = Date.now() + 5 * 60 * 1000;

      this.logger.log(`Anillustrious model version resolved: ${version}`);
      return version;
    } catch (err: any) {
      if (this.cachedVersion) {
        this.logger.warn(
          `Anillustrious version lookup failed, usando versión cacheada: ${err?.message}`,
        );
        return this.cachedVersion;
      }
      throw err;
    }
  }

  private async createPrediction(
    apiKey: string,
    body: Record<string, unknown>,
    controller: AbortController,
  ): Promise<ReplicatePrediction> {
    const response = await fetch(`${REPLICATE_API}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      this.logger.error(
        `Anillustrious create prediction failed: status=${response.status} detail=${detail}`,
      );
      throw new Error(`Replicate API error: ${response.status} ${detail}`);
    }

    return response.json() as Promise<ReplicatePrediction>;
  }

  private async pollPrediction(
    apiKey: string,
    predictionId: string,
    controller: AbortController,
  ): Promise<string> {
    while (true) {
      if (controller.signal.aborted) {
        throw new Error('Anillustrious prediction timed out');
      }

      const response = await fetch(
        `${REPLICATE_API}/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`Replicate polling error: ${response.status} ${detail}`);
      }

      const prediction = (await response.json()) as ReplicatePrediction;
      this.logger.debug(`Anillustrious prediction status: ${prediction.status}`);

      if (prediction.status === 'succeeded') {
        const url = Array.isArray(prediction.output)
          ? prediction.output[0]
          : prediction.output;
        if (!url || typeof url !== 'string') {
          throw new Error('Anillustrious prediction succeeded but no output URL');
        }
        return url;
      }

      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(
          `Anillustrious prediction ${prediction.status}: ${
            prediction.error ?? 'unknown error'
          }`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  private async downloadAsBase64(
    url: string,
  ): Promise<{ b64: string; contentType: string }> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const contentType = (
        res.headers.get('content-type') ?? 'image/png'
      ).toLowerCase();
      return {
        b64: Buffer.from(arrayBuffer).toString('base64'),
        contentType: contentType.startsWith('image/') ? contentType : 'image/png',
      };
    } catch (err: any) {
      this.logger.error(
        `Anillustrious image download error: ${err?.message ?? 'unknown'}`,
      );
      throw new Error('No pude descargar la imagen generada por Anillustrious.');
    }
  }

  private buildResult(
    b64: string,
    contentType: string,
    input: ImageGenerationInput,
  ): ImageGenerationResult {
    return {
      b64,
      contentType: contentType.startsWith('image/') ? contentType : 'image/png',
      model: ANILLUSTRIOUS_MODEL,
      provider: this.name,
      userId: input.userId,
      companionId: input.companionId,
      uuid: input.uuid,
    };
  }
}
