export type GenerateImageParams = {
  prompt: string;
  model?: string; // default: gpt-image-1-mini
  style?: string; // opcional, depende del modelo
  size?: "256x256" | "512x512" | "1024x1024" | "1536x1536" | "1024x1536" | "1536x1024";
  quality?: "low" | "medium" | "high" | "auto";
  outputFormat?: "png" | "jpeg" | "webp";
  timeoutMs?: number;
};

export type GenerateImageResult = {
  b64: string;
  contentType: string;
  model: string;
};