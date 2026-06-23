import { ConfigService } from '@nestjs/config';
import { ImageService } from './image.service';
import { StorageService } from '../storage/storage.service';
import { ImageProviderFactory } from './providers/image-provider.factory';
import { ImageGenerationResult } from './providers/image-provider.types';

describe('ImageService', () => {
  const config = {
    get: (key: string) => (key === 'OPENAI_API_KEY' ? 'test-key' : undefined),
  } as unknown as ConfigService;

  let storage: jest.Mocked<Pick<StorageService, 'uploadImage' | 'getSignedReadUrl'>>;

  beforeEach(() => {
    storage = {
      uploadImage: jest.fn().mockResolvedValue({
        filename: 'uuid-1/2026-06-04/abc.png',
        storagePath: 'uuid-1/2026-06-04/abc.png',
      }),
      getSignedReadUrl: jest.fn().mockResolvedValue('https://signed.example/abc.png'),
    } as any;
  });

  const segmindResult: ImageGenerationResult = {
    b64: Buffer.from('image-bytes').toString('base64'),
    contentType: 'image/png',
    model: 'imagen-4-fast',
    provider: 'segmind',
  };

  function buildFactory(overrides: Partial<ImageProviderFactory>): ImageProviderFactory {
    const factory: any = {
      getProvider: jest.fn(),
      getFallbackProvider: jest.fn(),
      isFallbackEnabled: jest.fn().mockReturnValue(false),
      ...overrides,
    };
    // El servicio enruta vía getProviderForInput; por defecto delega en getProvider.
    if (!factory.getProviderForInput) {
      factory.getProviderForInput = () => factory.getProvider();
    }
    return factory as ImageProviderFactory;
  }

  it('mantiene el contrato { uuid, filename, fileUrl, createdAt }', async () => {
    const provider = { name: 'segmind', generate: jest.fn().mockResolvedValue(segmindResult) };
    const factory = buildFactory({ getProvider: () => provider as any });

    const service = new ImageService({} as any, storage as any, config, factory);
    const res = await service.generateAndStoreImage({ prompt: 'hola', uuid: 'uuid-1' });

    expect(Object.keys(res).sort()).toEqual(['createdAt', 'fileUrl', 'filename', 'uuid']);
    expect(res.uuid).toBe('uuid-1');
    expect(res.filename).toBe('uuid-1/2026-06-04/abc.png');
    expect(res.fileUrl).toBe('https://signed.example/abc.png');
    expect(res.createdAt).toBeInstanceOf(Date);
    expect(storage.uploadImage).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'uuid-1', contentType: 'image/png', ext: 'png' }),
    );
  });

  it('exige prompt y uuid', async () => {
    const factory = buildFactory({ getProvider: () => ({ name: 'openai', generate: jest.fn() }) as any });
    const service = new ImageService({} as any, storage as any, config, factory);

    await expect(service.generateAndStoreImage({ prompt: '  ', uuid: 'x' })).rejects.toThrow();
    await expect(service.generateAndStoreImage({ prompt: 'ok', uuid: '' })).rejects.toThrow();
  });

  it('hace fallback a OpenAI cuando Segmind falla y el fallback está habilitado', async () => {
    const segmind = { name: 'segmind', generate: jest.fn().mockRejectedValue(new Error('boom')) };
    const openai = {
      name: 'openai',
      generate: jest.fn().mockResolvedValue({ ...segmindResult, provider: 'openai' }),
    };
    const factory = buildFactory({
      getProvider: () => segmind as any,
      getFallbackProvider: () => openai as any,
      isFallbackEnabled: () => true,
    });

    const service = new ImageService({} as any, storage as any, config, factory);
    const res = await service.generateAndStoreImage({ prompt: 'hola', uuid: 'uuid-1' });

    expect(segmind.generate).toHaveBeenCalledTimes(1);
    expect(openai.generate).toHaveBeenCalledTimes(1);
    expect(res.uuid).toBe('uuid-1');
  });

  it('NO hace fallback cuando está deshabilitado', async () => {
    const segmind = { name: 'segmind', generate: jest.fn().mockRejectedValue(new Error('boom')) };
    const openai = { name: 'openai', generate: jest.fn() };
    const factory = buildFactory({
      getProvider: () => segmind as any,
      getFallbackProvider: () => openai as any,
      isFallbackEnabled: () => false,
    });

    const service = new ImageService({} as any, storage as any, config, factory);
    await expect(service.generateAndStoreImage({ prompt: 'hola', uuid: 'uuid-1' })).rejects.toThrow();
    expect(openai.generate).not.toHaveBeenCalled();
  });
});
