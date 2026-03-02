import { Body, Controller, Post } from "@nestjs/common";
import { LlmService } from "./llm.service";

@Controller("llm")
export class LlmController {
  constructor(private readonly llm: LlmService) { }

  @Post("image-test")
  async imageTest(@Body() body: { prompt: string }) {
    const result = await this.llm.generateImage({
      prompt: body?.prompt ?? "Un zorro cyberpunk en Santiago, ilustración nocturna",
      model: "gpt-image-1-mini",
      quality: "high",
      size: "1024x1024",
      outputFormat: "png",
      timeoutMs: 60000, // 👈 CLAVE
    });

    return {
      contentType: result.contentType,
      b64: result.b64,
      model: result.model,
    };
  }
}
