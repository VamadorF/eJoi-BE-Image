import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { toFile } from 'openai';
import { GenerateImageDto } from './dto/generate-image.dto';
import { GenerateImageWithFileDto } from './dto/generate-image-with-file.dto';
import { buffer } from 'stream/consumers';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class ImageService {
    private openai: OpenAI;

    constructor(private configService: ConfigService, private readonly storage: StorageService) {
        this.openai = new OpenAI({
            apiKey: this.configService.get<string>('OPENAI_API_KEY'),
        });
    }

    async generateImageWithFile(dto: GenerateImageWithFileDto, file: Express.Multer.File) {
        try {
            if (!dto.prompt || dto.prompt.trim().length === 0) {
                throw new BadRequestException('El prompt es obligatorio');
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

            const imageFile = await toFile(
                file.buffer,
                file.originalname,
                {
                    type: file.mimetype,
                },
            );

            const response = await this.openai.images.edit({
                model: 'gpt-image-1',
                image: imageFile,
                prompt: dto.prompt,
                size: '1024x1024',
            });

            const imageBase64 = response.data?.[0]?.b64_json;

            if (!imageBase64) {
                throw new Error('No se recibió una imagen válida desde OpenAI');
            }

            const buffer = Buffer.from(imageBase64, 'base64');

            const uploaded = await this.storage.uploadImage({
                buffer,
                contentType: 'image/png',
                userId: dto.userId,
                ext: 'png',
            });

            const fileUrl = await this.storage.getSignedReadUrl(uploaded.storagePath);
            return {
                imageUrl: fileUrl,
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

