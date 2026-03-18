import { Body, Controller, Post } from "@nestjs/common";
import { LlmService } from "./llm.service";

@Controller("llm")
export class LlmController {
  constructor(private readonly llm: LlmService) { }

  @Post("image")
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
