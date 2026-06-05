import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ALLOWED_ASPECT_RATIOS,
  ImageAspectRatio,
  ImageGenerationInput,
  ImageGenerationResult,
  ImageProvider,
  ImageProviderName,
} from './image-provider.types';

const SEGMIND_ENDPOINT = 'https://api.segmind.com/v1/imagen-4-fast';
const SEGMIND_MODEL = 'imagen-4-fast';
const DEFAULT_NEGATIVE_PROMPT = 'blurry, pixelated, ugly, distorted, low quality';
const DEFAULT_ASPECT_RATIO: ImageAspectRatio = '16:9';
const DEFAULT_TIMEOUT_MS = 30000;

// Campos JSON donde Segmind podría devolver el base64 / la URL de la imagen.
const B64_FIELDS = ['image', 'b64', 'base64', 'output', 'data', 'image_base64'];
const URL_FIELDS = ['url', 'image_url', 'imageUrl', 'output', 'image', 'data'];

/**
 * Segmind Imagen 4 Fast (texto-a-imagen) provider.
 *
 * TODO: el formato exacto de respuesta de Segmind no se puede confirmar sin
 * ejecutar contra la API real. El parsing es defensivo (binario / JSON con
 * varias claves / URL / base64 directo). Ajustar `extractFromJson` tras la
 * primera llamada real si fuera necesario.
 */
@Injectable()
export class SegmindImageProvider implements ImageProvider {
  readonly name: ImageProviderName = 'segmind';

  private readonly logger = new Logger(SegmindImageProvider.name);

  constructor(private readonly config: ConfigService) {}

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const apiKey = this.config.get<string>('SEGMIND_API_KEY');
    if (!apiKey) {
      this.logger.error('SEGMIND_API_KEY no está configurada');
      throw new InternalServerErrorException(
        'El proveedor Segmind no está configurado correctamente.',
      );
    }

    const prompt = (input.prompt ?? '').trim();
    if (!prompt) {
      throw new InternalServerErrorException('Segmind: prompt vacío.');
    }

    const negativePrompt = this.resolveNegativePrompt(input.negativePrompt);
    const aspectRatio = this.resolveAspectRatio(input.aspectRatio);
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const body: Record<string, string> = { prompt, aspect_ratio: aspectRatio };
    if (negativePrompt) {
      body.negative_prompt = negativePrompt;
    }

    this.logger.log(
      `provider=segmind model=${SEGMIND_MODEL} aspect_ratio=${aspectRatio} prompt="${prompt.slice(0, 60)}"`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(SEGMIND_ENDPOINT, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      this.logger.error(
        `Segmind request error: ${aborted ? 'timeout' : (err?.message ?? 'unknown error')}`,
      );
      throw new InternalServerErrorException(
        'No pude generar la imagen en este momento. Por favor intenta nuevamente.',
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      await this.handleErrorStatus(response);
    }

    return this.parseResponse(response, input);
  }

  private resolveNegativePrompt(inputNegative?: string): string {
    const raw =
      inputNegative ??
      this.config.get<string>('SEGMIND_NEGATIVE_PROMPT') ??
      DEFAULT_NEGATIVE_PROMPT;
    const trimmed = (raw ?? '').trim();
    return trimmed; // no enviar string vacío
  }

  private resolveAspectRatio(inputAspect?: ImageAspectRatio): ImageAspectRatio {
    const candidate =
      inputAspect ??
      (this.config.get<string>('SEGMIND_DEFAULT_ASPECT_RATIO') as ImageAspectRatio) ??
      DEFAULT_ASPECT_RATIO;

    if (!ALLOWED_ASPECT_RATIOS.includes(candidate as ImageAspectRatio)) {
      this.logger.warn(
        `aspect_ratio inválido "${candidate}", usando '1:1' por defecto`,
      );
      return '1:1';
    }
    return candidate as ImageAspectRatio;
  }

  private async handleErrorStatus(response: Response): Promise<never> {
    const status = response.status;
    // Leer texto solo para logs (no se expone al cliente).
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // ignore
    }

    const messages: Record<number, string> = {
      400: 'Parámetros inválidos para el proveedor de imágenes.',
      401: 'El proveedor de imágenes no está autorizado.',
      403: 'Permisos insuficientes en el proveedor de imágenes.',
      404: 'El modelo de imágenes solicitado no está disponible.',
      406: 'Créditos insuficientes en el proveedor de imágenes.',
      429: 'Se alcanzó el límite de solicitudes. Intenta nuevamente en unos segundos.',
    };

    this.logger.error(`Segmind error: status=${status} detail=${detail}`);

    const clientMessage =
      messages[status] ??
      (status >= 500
        ? 'El proveedor de imágenes tuvo un error temporal. Intenta nuevamente.'
        : 'No pude generar la imagen en este momento. Por favor intenta nuevamente.');

    throw new InternalServerErrorException(clientMessage);
  }

  private async parseResponse(
    response: Response,
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    const contentTypeHeader = (response.headers.get('content-type') ?? '').toLowerCase();

    // 1) Respuesta binaria de imagen.
    if (contentTypeHeader.startsWith('image/')) {
      const arrayBuffer = await response.arrayBuffer();
      const b64 = Buffer.from(arrayBuffer).toString('base64');
      return this.buildResult(b64, contentTypeHeader, input);
    }

    // 2) JSON.
    if (contentTypeHeader.includes('application/json')) {
      let json: any;
      try {
        json = await response.json();
      } catch (err: any) {
        this.logger.error(`Segmind JSON parse error: ${err?.message ?? 'unknown'}`);
        throw new InternalServerErrorException(
          'Respuesta inválida del proveedor de imágenes.',
        );
      }
      return this.extractFromJson(json, input);
    }

    // 3) Texto: podría ser base64 directo o una URL.
    const text = (await response.text()).trim();
    if (this.looksLikeUrl(text)) {
      const { b64, contentType } = await this.downloadAsBase64(text);
      return this.buildResult(b64, contentType, input);
    }
    if (this.looksLikeBase64(text)) {
      return this.buildResult(text, 'image/png', input);
    }

    this.logger.error(
      `Segmind respuesta no normalizable: content-type=${contentTypeHeader} length=${text.length}`,
    );
    throw new InternalServerErrorException(
      'No pude interpretar la respuesta del proveedor de imágenes.',
    );
  }

  private async extractFromJson(
    json: any,
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    // Buscar base64 en campos comunes.
    for (const field of B64_FIELDS) {
      const value = this.pickString(json?.[field]);
      if (value) {
        if (this.looksLikeUrl(value)) {
          const { b64, contentType } = await this.downloadAsBase64(value);
          return this.buildResult(b64, contentType, input, json);
        }
        if (this.looksLikeBase64(value)) {
          const { b64, contentType } = this.parseDataUrlOrBase64(value);
          return this.buildResult(b64, contentType, input, json);
        }
      }
    }

    // Buscar una URL en campos comunes.
    for (const field of URL_FIELDS) {
      const value = this.pickString(json?.[field]);
      if (value && this.looksLikeUrl(value)) {
        const { b64, contentType } = await this.downloadAsBase64(value);
        return this.buildResult(b64, contentType, input, json);
      }
    }

    // Loggear la FORMA (keys) sin exponer contenido/secretos.
    const shape =
      json && typeof json === 'object'
        ? Object.keys(json).join(',')
        : typeof json;
    this.logger.error(`Segmind JSON sin imagen reconocible. shape=[${shape}]`);
    throw new InternalServerErrorException(
      'No pude interpretar la respuesta del proveedor de imágenes.',
    );
  }

  /** Acepta string directo o el primer elemento string de un array. */
  private pickString(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const first = value.find((v) => typeof v === 'string');
      if (typeof first === 'string') return first;
      // data:[{ url/b64 ... }]
      const firstObj = value.find((v) => v && typeof v === 'object');
      if (firstObj) {
        for (const f of [...B64_FIELDS, ...URL_FIELDS]) {
          if (typeof (firstObj as any)[f] === 'string') return (firstObj as any)[f];
        }
      }
    }
    return undefined;
  }

  private parseDataUrlOrBase64(value: string): { b64: string; contentType: string } {
    const dataUrlMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
    if (dataUrlMatch) {
      return { b64: dataUrlMatch[2], contentType: dataUrlMatch[1] };
    }
    return { b64: value, contentType: 'image/png' };
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
      const contentType = (res.headers.get('content-type') ?? 'image/png').toLowerCase();
      return {
        b64: Buffer.from(arrayBuffer).toString('base64'),
        contentType: contentType.startsWith('image/') ? contentType : 'image/png',
      };
    } catch (err: any) {
      this.logger.error(`Segmind image download error: ${err?.message ?? 'unknown'}`);
      throw new InternalServerErrorException(
        'No pude descargar la imagen generada por el proveedor.',
      );
    }
  }

  private buildResult(
    b64: string,
    contentType: string,
    input: ImageGenerationInput,
    raw?: unknown,
  ): ImageGenerationResult {
    return {
      b64,
      contentType: contentType.startsWith('image/') ? contentType : 'image/png',
      model: SEGMIND_MODEL,
      provider: this.name,
      userId: input.userId,
      companionId: input.companionId,
      uuid: input.uuid,
      raw,
    };
  }

  private looksLikeUrl(value: string): boolean {
    return /^https?:\/\//i.test(value.trim());
  }

  private looksLikeBase64(value: string): boolean {
    const v = value.trim();
    if (v.startsWith('data:image/')) return true;
    if (v.length < 100) return false; // demasiado corto para ser una imagen
    return /^[A-Za-z0-9+/=\r\n]+$/.test(v);
  }
}
