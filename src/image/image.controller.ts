import { Body, Controller, Post, HttpCode, HttpStatus, UseGuards, UploadedFile, UseInterceptors, Inject } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImageService } from './image.service';
import { GenerateImageWithFileDto } from './dto/generate-image-with-file.dto';
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { LlmService } from "../llm/llm.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiTags, ApiOperation } from "@nestjs/swagger";

@ApiTags('image')
@Controller('image')
export class ImageController {
    constructor(
        private readonly imageService: ImageService,
        private readonly llm: LlmService,
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    ) { }

    @Post("generate")
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Generar y almacenar una imagen' })
    async imageTest(@Body() body: { prompt: string; userId: string; companionId?: string }) {
        const prompt = body?.prompt ?? "Un zorro cyberpunk en Santiago, ilustración nocturna";
        const uuid = body.companionId || body?.userId;

        const cacheKey = `llm:image:${uuid}:${prompt.trim().toLowerCase()}`;

        const cached = await this.cacheManager.get<{
            userId: string;
            filename: string;
            fileUrl: string;
            createdAt: string;
        }>(cacheKey);

        if (cached) {
            console.log("CACHE HIT — userId:", uuid);
            return cached;
        }
        console.log("CACHE MISS — userId:", uuid);

        const result = await this.llm.generateAndStoreImage({
            userId: uuid,
            prompt,
            model: "gpt-image-1",
            quality: "high",
            size: "1024x1024",
            outputFormat: "png",
            timeoutMs: 60000,
        });

        const response = {
            userId: result.userId,
            filename: result.filename,
            fileUrl: result.fileUrl,
            createdAt: result.createdAt,
        };

        await this.cacheManager.set(cacheKey, response, 10 * 60 * 1000);

        return response;
    }

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