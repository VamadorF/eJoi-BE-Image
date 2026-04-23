import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";    
import { Cache } from "cache-manager";                    
import { LlmService } from "./llm.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiTags, ApiOperation } from "@nestjs/swagger";


@ApiTags('llm')
@Controller("llm")
export class LlmController {
  constructor(
    private readonly llm: LlmService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache, 
  ) {}

  @Post("image")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generar y almacenar una imagen' })
  async imageTest(@Body() body: { prompt: string; companionId: string }) {
    const prompt = body?.prompt ?? "Un zorro cyberpunk en Santiago, ilustración nocturna";
    const companionId = body?.companionId;

    const cacheKey = `llm:image:${companionId}:${prompt.trim().toLowerCase()}`;

    const cached = await this.cacheManager.get<{
      companionId: string;
      filename: string;
      fileUrl: string;
      createdAt: string;
    }>(cacheKey);

    if (cached) {
      console.log("CACHE HIT — companionId:", companionId);
      return cached;
    }
    console.log("CACHE MISS — companionId:", companionId);

    const result = await this.llm.generateAndStoreImage({
      companionId,
      prompt,
      model: "gpt-image-1",
      quality: "high",
      size: "1024x1024",
      outputFormat: "png",
      timeoutMs: 60000,
    });

    const response = {
      companionId: result.companionId,
      filename: result.filename,
      fileUrl: result.fileUrl,
      createdAt: result.createdAt,
    };

    await this.cacheManager.set(cacheKey, response, 10 * 60 * 1000);

    return response;
  }
}