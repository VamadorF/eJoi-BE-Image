import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { toFile } from 'openai';
import { GenerateImageDto } from './dto/generate-image.dto';
import { GenerateImageWithFileDto } from './dto/generate-image-with-file.dto';

@Injectable()
export class ImageService {
    private openai: OpenAI;

    constructor(private configService: ConfigService) {
        this.openai = new OpenAI({
            apiKey: this.configService.get<string>('OPENAI_API_KEY'),
        });
    }

    async generateImageDallE(dto: GenerateImageDto) {
        try {
            const response = await this.openai.images.generate({
                model: 'dall-e-3',
                prompt: dto.prompt,
                n: 1,
                size: dto.size ?? '1024x1024',
                quality: dto.quality ?? 'standard',
                style: dto.style ?? 'vivid',
            });

            if (!response.data || !response.data[0] || !response.data[0].url) {
                throw new Error('No se recibió una URL de imagen válida');
            }
            
            return {
                imageUrl: response.data[0].url,
                revisedPrompt: response.data[0].revised_prompt,
            };
        } catch (error: any) {
            throw new InternalServerErrorException(
                error.message || 'Error al generar la imagen',
            );
        }
    }
  async generateImageWithFile(dto: GenerateImageWithFileDto, file: Express.Multer.File ) 
  {
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

      return {
        imageBase64,
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

