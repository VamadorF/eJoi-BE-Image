import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GenerateImageDto } from './dto/generate-image.dto';

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
}