import { Body, Controller, Post, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ImageService } from './image.service';
import { GenerateImageDto } from './dto/generate-image.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; 

@Controller('image')
export class ImageController {
    constructor(private readonly imageService: ImageService) { }

    @Post('generate')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard)
    async generateImage(@Body() dto: GenerateImageDto) {
        return this.imageService.generateImageDallE(dto);
    }
}