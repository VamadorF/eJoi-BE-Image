import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ImageGenerationInput,
  ImageGenerationResult,
  ImageProvider,
  ImageProviderName,
} from './image-provider.types';

const REPLICATE_API = 'https://api.replicate.com/v1';
const FLUX_MODEL = 'black-forest-labs/flux-2-pro';
const DEFAULT_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 1000;

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[];
  error?: string;
}

interface ReplicateModelResponse {
  latest_version: { id: string };
}

@Injectable()
export class FluxImageProvider implements ImageProvider {
  readonly name: ImageProviderName = 'flux';

  private readonly logger = new Logger(FluxImageProvider.name);
  private cachedVersion: string | null = null;
  private versionExpiry: number = 0;

  constructor(private readonly config: ConfigService) {}

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const apiKey = this.config.get<string>('REPLICATE_API_KEY');
    if (!apiKey) {
      this.logger.error('REPLICATE_API_KEY no está configurada');
      throw new InternalServerErrorException(
        'El proveedor Flux no está configurado correctamente.',
      );
    }

    const prompt = (input.prompt ?? '').trim();
    if (!prompt) {
      throw new InternalServerErrorException('Flux: prompt vacío.');
    }

    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const outputFormat =
      input.outputFormat === 'jpeg' ? 'jpg' : input.outputFormat ?? 'webp';

    const version = await this.resolveModelVersion(apiKey);

    const body = {
      version,
      input: {
        prompt,
        aspect_ratio: input.aspectRatio ?? '1:1',
        output_format: outputFormat,
      },
    };

    this.logger.log(
      `provider=flux model=${FLUX_MODEL} version=${version} prompt="${prompt.slice(0, 60)}"`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let prediction: ReplicatePrediction;
    try {
      prediction = await this.createPrediction(apiKey, body, controller);
    } catch (err: any) {
      this.logger.error(`Flux create prediction error: ${err?.message ?? 'unknown'}`);
      throw new InternalServerErrorException(
        'No pude generar la imagen en este momento. Por favor intenta nuevamente.',
      );
    } finally {
      clearTimeout(timeout);
    }

    try {
      const outputUrl = await this.pollPrediction(apiKey, prediction.id, controller);
      const { b64, contentType } = await this.downloadAsBase64(outputUrl);
      return this.buildResult(b64, contentType, input);
    } catch (err: any) {
      this.logger.error(`Flux polling/download error: ${err?.message ?? 'unknown'}`);
      throw new InternalServerErrorException(
        'No pude generar la imagen en este momento. Por favor intenta nuevamente.',
      );
    }
  }

  private async resolveModelVersion(apiKey: string): Promise<string> {
    if (this.cachedVersion && Date.now() < this.versionExpiry) {
      return this.cachedVersion;
    }

    try {
      const response = await fetch(`${REPLICATE_API}/models/${FLUX_MODEL}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        this.logger.error(
          `Flux resolve model failed: status=${response.status} detail=${detail}`,
        );
        throw new Error(`Replicate model lookup failed: ${response.status}`);
      }

      const modelData = (await response.json()) as ReplicateModelResponse;
      const version = modelData.latest_version?.id;

      if (!version) {
        throw new Error('No se encontró versión del modelo FLUX en Replicate');
      }

      this.cachedVersion = version;
      this.versionExpiry = Date.now() + 5 * 60 * 1000;

      this.logger.log(`Flux model version resolved: ${version}`);
      return version;
    } catch (err: any) {
      if (this.cachedVersion) {
        this.logger.warn(
          `Flux version lookup failed, usando versión cacheada: ${err?.message}`,
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
        `Flux create prediction failed: status=${response.status} detail=${detail}`,
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
        throw new Error('Flux prediction timed out');
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
      this.logger.debug(`Flux prediction status: ${prediction.status}`);

      if (prediction.status === 'succeeded') {
        const url = Array.isArray(prediction.output)
          ? prediction.output[0]
          : prediction.output;
        if (!url || typeof url !== 'string') {
          throw new Error('Flux prediction succeeded but no output URL');
        }
        return url;
      }

      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(
          `Flux prediction ${prediction.status}: ${
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
        contentType: contentType.startsWith('image/')
          ? contentType
          : 'image/png',
      };
    } catch (err: any) {
      this.logger.error(
        `Flux image download error: ${err?.message ?? 'unknown'}`,
      );
      throw new Error('No pude descargar la imagen generada por Flux.');
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
      model: FLUX_MODEL,
      provider: this.name,
      userId: input.userId,
      companionId: input.companionId,
      uuid: input.uuid,
    };
  }
}
