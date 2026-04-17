import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { LlmService } from "./llm.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";


@Controller("llm")
export class LlmController {
  constructor(private readonly llm: LlmService) { }

  @Post("image")
  @UseGuards(JwtAuthGuard)
  async imageTest(@Body() body: { prompt: string; companionId: string }) {
    const result = await this.llm.generateAndStoreImage({
      companionId: body?.companionId,
      prompt: body?.prompt ?? "Un zorro cyberpunk en Santiago, ilustración nocturna",
      model: "gpt-image-1",
      quality: "high",
      size: "1024x1024",
      outputFormat: "png",
      timeoutMs: 60000,
    });

    return {
      companionId: result.companionId,
      filename: result.filename,
      fileUrl: result.fileUrl,
      createdAt: result.createdAt,
    };
  }
}
