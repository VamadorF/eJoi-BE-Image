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
  ) { }

  @Post("image")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generar y almacenar una imagen' })
  async imageTest(@Body() body: { prompt: string; userId: string }) {
    const prompt = body?.prompt ?? "Un zorro cyberpunk en Santiago, ilustración nocturna";
    const userId = body?.userId;

    const cacheKey = `llm:image:${userId}:${prompt.trim().toLowerCase()}`;

    const cached = await this.cacheManager.get<{
      userId: string;
      filename: string;
      fileUrl: string;
      createdAt: string;
    }>(cacheKey);

    if (cached) {
      console.log("CACHE HIT — userId:", userId);
      return cached;
    }
    console.log("CACHE MISS — userId:", userId);

    const result = await this.llm.generateAndStoreImage({
      userId,
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
}