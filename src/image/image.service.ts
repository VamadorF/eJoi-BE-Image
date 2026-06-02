import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { GenerateImageWithFileDto } from './dto/generate-image-with-file.dto';
import { StorageService } from '../storage/storage.service';
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ImageService {
    private readonly logger = new Logger(ImageService.name);

    constructor(
        private readonly llm: LlmService,
        private readonly storage: StorageService,
        private readonly configService: ConfigService,
    ) { }

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
