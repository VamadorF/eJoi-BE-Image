import { BadRequestException, Body, Controller, Post, HttpCode, HttpStatus, UseGuards, UploadedFile, UseInterceptors, Inject, Logger } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageService } from './image.service';
import { GenerateImageWithFileDto } from './dto/generate-image-with-file.dto';
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { ImageAspectRatio } from "./providers/image-provider.types";

@ApiTags('image')
@Controller('image')
export class ImageController {
    private readonly logger = new Logger(ImageController.name);

    constructor(
        private readonly imageService: ImageService,
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    ) { }

    @Post("generate")
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Generar y almacenar una imagen' })
    async generateAndStoreImage(@Body() body: { prompt: string; userId?: string; companionId?: string, uuid?: string, negativePrompt?: string, aspectRatio?: ImageAspectRatio }) {
        const prompt = body?.prompt ?? "Un logo extraordinario en una noche cyberpunk con un cartel de neon que dice eJoi!";

        const uuid = body?.uuid ? body.uuid :  (body?.companionId || body?.userId) || undefined;

        this.logger.log("Received request to generate image with uuid:", uuid);

        const result = await this.imageService.generateAndStoreImage({
            uuid,
            prompt,
            model: "gpt-image-1-mini",
            quality: "low",
            size: "1024x1024",
            outputFormat: "png",
            timeoutMs: 30000,
            negativePrompt: body?.negativePrompt,
            aspectRatio: body?.aspectRatio,
        });

        return {
            uuid: result.uuid,
            filename: result.filename,
            fileUrl: result.fileUrl,
            storagePath: result.storagePath,
            createdAt: result.createdAt,
        };
    }

    @Post('generate-with-image')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(FileInterceptor('image'))
    async generateImageWithFile(
        @Body() dto: GenerateImageWithFileDto,
        @UploadedFile() file: Express.Multer.File,
    ) {

        this.logger.log('Received file:', {
            originalname: file?.originalname,
            mimetype: file?.mimetype,
            size: file?.size,
            dateTimestampProvider: new Date().toISOString(),
        });

        return this.imageService.generateImageWithFile(dto, file);
    }
}
