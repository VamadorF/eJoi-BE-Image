import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { LlmService } from "./llm.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiTags, ApiOperation } from "@nestjs/swagger";


@ApiTags('llm')
@Controller("llm")
export class LlmController {
  constructor(
    private readonly llm: LlmService,
  ) { }

  @Post("image")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generar y almacenar una imagen' })
  async imageTest(@Body() body: { prompt: string; userId: string; companionId?: string; uuid?: string }) {
    const prompt = body?.prompt ?? "Un zorro cyberpunk en Santiago, ilustración nocturna";

    const uuid = body.uuid ? body.uuid :  (body.companionId || body?.userId);

    const result = await this.llm.generateAndStoreImage({
      uuid: uuid,
      prompt,
      model: "gpt-image-1-mini",
      quality: "low",
      size: "1024x1024",
      outputFormat: "png",
      timeoutMs: 30000,
    });

    return {
      uuid: result.uuid,
      filename: result.filename,
      fileUrl: result.fileUrl,
      createdAt: result.createdAt,
    };
  }
}