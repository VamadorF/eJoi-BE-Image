import { ConfigService } from '@nestjs/config';
import { ImageProviderFactory } from './image-provider.factory';
import { OpenAiImageProvider } from './openai-image.provider';
import { SegmindImageProvider } from './segmind-image.provider';

describe('ImageProviderFactory', () => {
  const openAiProvider = { name: 'openai' } as OpenAiImageProvider;
  const segmindProvider = { name: 'segmind' } as SegmindImageProvider;

  function buildFactory(config: Record<string, string | undefined>) {
    const configService = {
      get: (key: string) => config[key],
    } as unknown as ConfigService;

    return new ImageProviderFactory(configService, openAiProvider, segmindProvider);
  }

  it('usa OpenAI por defecto cuando IMAGE_PROVIDER está ausente', () => {
    const factory = buildFactory({});
    expect(factory.getProvider().name).toBe('openai');
  });

  it('usa Segmind cuando IMAGE_PROVIDER=segmind', () => {
    const factory = buildFactory({ IMAGE_PROVIDER: 'segmind' });
    expect(factory.getProvider().name).toBe('segmind');
  });

  it('vuelve a OpenAI cuando IMAGE_PROVIDER es inválido', () => {
    const factory = buildFactory({ IMAGE_PROVIDER: 'midjourney' });
    expect(factory.getProvider().name).toBe('openai');
  });

  it('es case-insensitive y tolera espacios', () => {
    const factory = buildFactory({ IMAGE_PROVIDER: '  SEGMIND ' });
    expect(factory.getProvider().name).toBe('segmind');
  });

  it('getFallbackProvider siempre devuelve OpenAI', () => {
    const factory = buildFactory({ IMAGE_PROVIDER: 'segmind' });
    expect(factory.getFallbackProvider().name).toBe('openai');
  });

  it('isFallbackEnabled refleja ENABLE_IMAGE_PROVIDER_FALLBACK', () => {
    expect(buildFactory({}).isFallbackEnabled()).toBe(false);
    expect(
      buildFactory({ ENABLE_IMAGE_PROVIDER_FALLBACK: 'true' }).isFallbackEnabled(),
    ).toBe(true);
    expect(
      buildFactory({ ENABLE_IMAGE_PROVIDER_FALLBACK: 'TRUE' }).isFallbackEnabled(),
    ).toBe(true);
    expect(
      buildFactory({ ENABLE_IMAGE_PROVIDER_FALLBACK: 'false' }).isFallbackEnabled(),
    ).toBe(false);
  });
});
