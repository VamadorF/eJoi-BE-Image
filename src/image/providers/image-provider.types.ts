export type ImageProviderName = 'openai' | 'segmind' | 'flux';

export type ImageAspectRatio = '1:1' | '4:3' | '3:4' | '9:16' | '16:9';

export const ALLOWED_ASPECT_RATIOS: ImageAspectRatio[] = [
  '1:1',
  '4:3',
  '3:4',
  '9:16',
  '16:9',
];

export interface ImageGenerationInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: ImageAspectRatio;
  model?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?:
    | '256x256'
    | '512x512'
    | '1024x1024'
    | '1536x1536'
    | '1024x1536'
    | '1536x1024';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  timeoutMs?: number;
  userId?: string;
  companionId?: string;
  uuid?: string;
}

export interface ImageGenerationResult {
  b64: string;
  contentType: string;
  model: string;
  provider: ImageProviderName;
  userId?: string;
  companionId?: string;
  uuid?: string;
  raw?: unknown;
}

export interface ImageProvider {
  readonly name: ImageProviderName;
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}
