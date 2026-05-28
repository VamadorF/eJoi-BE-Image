import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { GenerateImageParams, GenerateImageResult } from "./llm.types";
import { StorageService } from "src/storage/storage.service";

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly defaultTemperature: number;
  private readonly defaultMaxOutputTokens: number;
  private readonly defaultTimeoutMs: number;

  constructor(private readonly config: ConfigService, private readonly storage: StorageService) {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY in environment");
    }

    this.client = new OpenAI({ apiKey });

    this.defaultModel = this.config.get<string>("LLM_MODEL") ?? "gpt-4o-mini";
    this.defaultTemperature = Number(this.config.get<string>("LLM_TEMPERATURE") ?? "0.7");
    this.defaultMaxOutputTokens = Number(this.config.get<string>("LLM_MAX_OUTPUT_TOKENS") ?? "300");
    this.defaultTimeoutMs = 55000; //Number(this.config.get<string>("LLM_TIMEOUT_MS") ?? "12000");
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("LLM timeout")), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  async generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
    const prompt = (params.prompt ?? "").trim();
    if (!prompt) {
      throw new InternalServerErrorException("LLM: prompt vacío.");
    }

    // defaults (separados de texto para no mezclar configs)
    const model = params.model ?? "gpt-image-1-mini";
    const size = params.size ?? "1024x1024";
    const quality = params.quality ?? "low"; // fast by default
    const outputFormat = params.outputFormat ?? "png";
    const timeoutMs = params.timeoutMs ?? this.defaultTimeoutMs;

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
        this.logger.warn("Image API returned empty b64_json");
        throw new Error("Empty image response");
      }

      const contentType =
        outputFormat === "png"
          ? "image/png"
          : outputFormat === "jpeg"
            ? "image/jpeg"
            : "image/webp";

      this.logger.log(`Generated image with model ${model}, size ${size}, quality ${quality}, outputFormat ${outputFormat}`);
      return { b64, contentType, model };
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const code = err?.code;
      const msg = typeof err?.message === "string" ? err.message : "unknown error";
      const details = err?.response?.data ?? err?.error ?? undefined;

      this.logger.error(
        `Image gen error: status=${status ?? "n/a"} code=${code ?? "n/a"} msg=${msg}`,
      );

      // OJO: esto va SOLO a logs (no al cliente)
      if (details) this.logger.error(`Image gen details: ${JSON.stringify(details)}`);

      throw new InternalServerErrorException(
        "No pude generar la imagen en este momento. Por favor intenta nuevamente.",
      );
    }
  }

  async generateAndStoreImage(params: GenerateImageParams): Promise<{
    uuid: string;
    filename: string;
    fileUrl: string;
    storagePath: string;
    createdAt: Date;
  }> {
    const prompt = (params.prompt ?? "").trim();
    if (!prompt) {
      throw new InternalServerErrorException("LLM: prompt vacío.");
    }

    if (!params.uuid) {
      throw new InternalServerErrorException("uuid es requerido para almacenar la imagen.");
    }

    const model = params.model ?? "gpt-image-1";
    const size = params.size ?? "1024x1024";
    const quality = params.quality ?? "high";
    const outputFormat = params.outputFormat ?? "png";
    const timeoutMs = params.timeoutMs ?? this.defaultTimeoutMs;

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
        this.logger.warn("Image API returned empty b64_json");
        throw new Error("Empty image response");
      }

      const contentType =
        outputFormat === "png"
          ? "image/png"
          : outputFormat === "jpeg"
            ? "image/jpeg"
            : "image/webp";

      const buffer = Buffer.from(b64, "base64");

      console.log(`Generated image of size ${buffer.length} bytes, contentType: ${contentType}`);

      const uploaded = await this.storage.uploadImage({
        buffer,
        contentType,
        uuid: params.uuid,
        ext: outputFormat,
      });

      const isPublicRead = this.config.get<string>("GCS_PUBLIC_READ") === "true";
      const fileUrl = isPublicRead
        ? this.storage.getPublicUrl(uploaded.storagePath)
        : await this.storage.getSignedReadUrl(uploaded.storagePath, 60);

      console.log(`Image uploaded to storage with filename: ${uploaded.filename}, accessible at: ${fileUrl}`);

      return {
        uuid: params.uuid,
        filename: uploaded.filename,
        fileUrl,
        storagePath: uploaded.storagePath,
        createdAt: new Date(),
      };
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const code = err?.code;
      const msg = typeof err?.message === "string" ? err.message : "unknown error";

      this.logger.error(
        `Image gen error: status=${status ?? "n/a"} code=${code ?? "n/a"} msg=${msg}`,
      );

      throw new InternalServerErrorException(
        "No pude generar la imagen en este momento. Por favor intenta nuevamente.",
      );
    }
  }
}
