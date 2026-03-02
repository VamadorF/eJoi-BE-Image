import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ImageService } from './image.service';
import { GenerateImageDto } from './dto/generate-image.dto';

@Controller('image')
export class ImageController {
    constructor(private readonly imageService: ImageService) { }

    @Post('generate')
    @HttpCode(HttpStatus.OK)
    async generateImage(@Body() dto: GenerateImageDto) {
        return this.imageService.generateImageDallE(dto);
    }
}