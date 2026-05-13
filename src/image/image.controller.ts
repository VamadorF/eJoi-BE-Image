import { Body, Controller, Post, HttpCode, HttpStatus, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageService } from './image.service';
import { GenerateImageDto } from './dto/generate-image.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags } from "@nestjs/swagger";
import { use } from 'passport';
import { GenerateImageWithFileDto } from './dto/generate-image-with-file.dto';
import { dateTimestampProvider } from 'rxjs/internal/scheduler/dateTimestampProvider';

@ApiTags('image')
@Controller('image')
export class ImageController {
    constructor(private readonly imageService: ImageService) { }

    @Post('generate-with-image')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(FileInterceptor('image'))
    async generateImageWithFile(
        @Body() dto: GenerateImageWithFileDto,
        @UploadedFile() file: Express.Multer.File,
    ) {

        console.log('Received file:', {
            originalname: file?.originalname,
            mimetype: file?.mimetype,
            size: file?.size,
            dateTimestampProvider: new Date().toISOString(),
        });

        return this.imageService.generateImageWithFile(dto, file);
    }
}