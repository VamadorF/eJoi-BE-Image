import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service';
import { GenerateImageWithFileDto } from './dto/generate-image-with-file.dto';
import { StorageService } from '../storage/storage.service';
import { ImageProviderFactory } from './providers/image-provider.factory';
import { ImageGenerationInput, ImageGenerationResult } from './providers/image-provider.types';

@Injectable()
export class ImageService {
    private readonly logger = new Logger(ImageService.name);

    constructor(
        private readonly llm: LlmService,
        private readonly storage: StorageService,
        private readonly configService: ConfigService,
        private readonly providerFactory: ImageProviderFactory,
    ) { }

    /**
     * Punto de entrada principal para generación + almacenamiento de imágenes.
     * Resuelve el provider vía factory (OpenAI/Segmind), aplica fallback opcional
     * y mantiene el contrato de respuesta de POST /image/generate.
     */
    async generateAndStoreImage(params: ImageGenerationInput): Promise<{
        uuid: string;
        filename: string;
        fileUrl: string;
        storagePath: string;
        createdAt: Date;
    }> {
        const prompt = (params.prompt ?? '').trim();
        if (!prompt) {
            throw new BadRequestException('El prompt es obligatorio');
        }

        const uuid = params.uuid?.trim();
        if (!uuid) {
            throw new BadRequestException('El uuid es obligatorio');
        }

        const input: ImageGenerationInput = { ...params, prompt, uuid };
        const result = await this.generateWithFallback(input);

        const ext = this.extFromContentType(result.contentType);
        const buffer = Buffer.from(result.b64, 'base64');

        this.logger.log(
            `Imagen generada provider=${result.provider} model=${result.model} bytes=${buffer.length}`,
        );

        const uploaded = await this.storage.uploadImage({
            buffer,
            contentType: result.contentType,
            uuid,
            ext,
        });

        const fileUrl = await this.storage.getSignedReadUrl(uploaded.storagePath);

        return {
            uuid,
            filename: uploaded.filename,
            fileUrl,
            storagePath: uploaded.storagePath,
            createdAt: new Date(),
        };
    }

    private async generateWithFallback(
        input: ImageGenerationInput,
    ): Promise<ImageGenerationResult> {
        const primary = this.providerFactory.getProvider(input.prompt);
        this.logger.log(`Provider seleccionado: ${primary.name}`);

        try {
            return await primary.generate(input);
        } catch (primaryErr: any) {
            const status = primaryErr?.status ?? primaryErr?.response?.status;
            const code = primaryErr?.code;
            this.logger.error(
                `Provider primario "${primary.name}" falló: status=${status ?? 'n/a'} code=${code ?? 'n/a'}`,
            );

            const fallbackEnabled = this.providerFactory.isFallbackEnabled();
            const fallback = this.providerFactory.getFallbackProvider();

            // Anillustrious siempre cae a OpenAI ante un fallo; Segmind respeta el flag.
            const anillustriousFallback = primary.name === 'anillustrious';
            const segmindFallback = primary.name === 'segmind' && fallbackEnabled;

            if ((anillustriousFallback || segmindFallback) && fallback.name !== primary.name) {
                this.logger.warn(`Fallback aplicado: "${primary.name}" → "${fallback.name}"`);
                try {
                    // `input.prompt` es el prompt original del frontend (sin transformar):
                    // la conversión a tags vive solo dentro del provider Anillustrious.
                    const result = await fallback.generate(input);
                    this.logger.log(`Fallback usado correctamente: provider=${fallback.name}`);
                    return result;
                } catch (fallbackErr: any) {
                    this.logger.error(
                        `Fallback "${fallback.name}" también falló: ${fallbackErr?.message ?? 'unknown'}`,
                    );
                    throw new InternalServerErrorException(
                        'No pude generar la imagen en este momento. Por favor intenta nuevamente.',
                    );
                }
            }

            if (primaryErr instanceof InternalServerErrorException || primaryErr instanceof BadRequestException) {
                throw primaryErr;
            }
            throw new InternalServerErrorException(
                'No pude generar la imagen en este momento. Por favor intenta nuevamente.',
            );
        }
    }

    private extFromContentType(contentType: string): 'png' | 'jpeg' | 'webp' {
        if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpeg';
        if (contentType.includes('webp')) return 'webp';
        return 'png';
    }

    async generateImageWithFile(dto: GenerateImageWithFileDto, file: Express.Multer.File) {
        try {
            if (!dto.prompt || dto.prompt.trim().length === 0) {
                throw new BadRequestException('El prompt es obligatorio');
            }

            if (!dto.uuid || dto.uuid.trim().length === 0) {
                throw new BadRequestException('El uuid es obligatorio');
            }

            if (!file) {
                throw new BadRequestException('La imagen es obligatoria');
            }

            const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];

            if (!allowedMimeTypes.includes(file.mimetype)) {
                throw new BadRequestException(
                    'Formato de imagen no permitido. Usa PNG, JPG, JPEG o WEBP.',
                );
            }

            const maxSizeInBytes = 10 * 1024 * 1024;

            if (file.size > maxSizeInBytes) {
                throw new BadRequestException(
                    'La imagen no puede superar los 10MB.',
                );
            }

            const result = await this.llm.generateImage({
                prompt: dto.prompt,
                model: 'gpt-image-1-mini',
                quality: 'low',
                size: '1024x1024',
                outputFormat: 'png',
                timeoutMs: 30000,
            });

            const buffer = Buffer.from(result.b64, 'base64');

            const uploaded = await this.storage.uploadImage({
                buffer,
                contentType: 'image/png',
                uuid: dto.uuid,
                ext: 'png',
            });

            const isPublicRead = this.configService.get<string>("GCS_PUBLIC_READ") === "true";
            const fileUrl = isPublicRead
                ? this.storage.getPublicUrl(uploaded.storagePath)
                : await this.storage.getSignedReadUrl(uploaded.storagePath, 60);

            return {
                fileUrl,
                storagePath: uploaded.storagePath,
                filename: uploaded.filename,
                uuid: dto.uuid,
            };
        } catch (error: any) {
            if (error instanceof BadRequestException) {
                throw error;
            }

            throw new InternalServerErrorException(
                error.message || 'Error al generar imagen con archivo',
            );
        }
    }
}
