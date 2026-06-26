import { ConfigService } from '@nestjs/config';
import { ImageService } from './image.service';
import { StorageService } from '../storage/storage.service';
import { ImageProviderFactory } from './providers/image-provider.factory';
import { ImageGenerationResult } from './providers/image-provider.types';

describe('ImageService', () => {
  const config = {
    get: (key: string) => (key === 'OPENAI_API_KEY' ? 'test-key' : undefined),
  } as unknown as ConfigService;

  const llm = { generateImage: jest.fn() };

  let storage: jest.Mocked<Pick<StorageService, 'uploadImage' | 'getSignedReadUrl'>>;

  beforeEach(() => {
    jest.clearAllMocks();
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

  const validFile = {
    buffer: Buffer.from('source-image'),
    mimetype: 'image/png',
    originalname: 'source.png',
    size: 1024,
  } as Express.Multer.File;

  function buildFactory(overrides: Partial<ImageProviderFactory>): ImageProviderFactory {
    return {
      getProvider: jest.fn(),
      getFallbackProvider: jest.fn(),
      isFallbackEnabled: jest.fn().mockReturnValue(false),
      ...overrides,
    } as unknown as ImageProviderFactory;
  }

  it('mantiene el contrato { uuid, filename, fileUrl, createdAt }', async () => {
    const provider = {
      name: 'segmind',
      generate: jest.fn().mockResolvedValue(segmindResult),
    };
    const factory = buildFactory({ getProvider: () => provider as any });

    const service = new ImageService(llm as any, storage as any, config, factory);
    const res = await service.generateAndStoreImage({ prompt: 'hola', uuid: 'uuid-1' });

    expect(Object.keys(res).sort()).toEqual([
      'createdAt',
      'fileUrl',
      'filename',
      'storagePath',
      'uuid',
    ]);
    expect(res.uuid).toBe('uuid-1');
    expect(res.filename).toBe('uuid-1/2026-06-04/abc.png');
    expect(res.fileUrl).toBe('https://signed.example/abc.png');
    expect(res.createdAt).toBeInstanceOf(Date);
    expect(storage.uploadImage).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'uuid-1', contentType: 'image/png', ext: 'png' }),
    );
  });

  it('exige prompt y uuid', async () => {
    const factory = buildFactory({
      getProvider: () => ({ name: 'openai', generate: jest.fn() }) as any,
    });
    const service = new ImageService(llm as any, storage as any, config, factory);

    await expect(service.generateAndStoreImage({ prompt: '  ', uuid: 'x' })).rejects.toThrow();
    await expect(service.generateAndStoreImage({ prompt: 'ok', uuid: '' })).rejects.toThrow();
  });

  it('edita una imagen con Flux y guarda el resultado', async () => {
    storage.uploadImage
      .mockResolvedValueOnce({
        filename: 'uuid-1/2026-06-04/source.png',
        storagePath: 'uuid-1/2026-06-04/source.png',
      })
      .mockResolvedValueOnce({
        filename: 'uuid-1/2026-06-04/result.png',
        storagePath: 'uuid-1/2026-06-04/result.png',
      });
    storage.getSignedReadUrl
      .mockResolvedValueOnce('https://signed.example/source.png')
      .mockResolvedValueOnce('https://signed.example/result.png');

    const fluxResult: ImageGenerationResult = {
      b64: Buffer.from('edited-image').toString('base64'),
      contentType: 'image/png',
      model: 'black-forest-labs/flux-2-pro',
      provider: 'flux',
    };
    const flux = {
      name: 'flux',
      generate: jest.fn(),
      edit: jest.fn().mockResolvedValue(fluxResult),
    };
    const factory = buildFactory({ getProvider: () => flux as any });

    const service = new ImageService(llm as any, storage as any, config, factory);
    const res = await service.generateImageWithFile(
      { prompt: 'cambia el fondo', uuid: 'uuid-1' },
      validFile,
    );

    expect(storage.uploadImage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        buffer: validFile.buffer,
        contentType: 'image/png',
        uuid: 'uuid-1',
        ext: 'png',
      }),
    );
    expect(storage.getSignedReadUrl).toHaveBeenNthCalledWith(
      1,
      'uuid-1/2026-06-04/source.png',
      15,
    );
    expect(flux.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'cambia el fondo',
        uuid: 'uuid-1',
        outputFormat: 'png',
        inputImages: ['https://signed.example/source.png'],
      }),
    );
    expect(llm.generateImage).not.toHaveBeenCalled();
    expect(res).toEqual({
      fileUrl: 'https://signed.example/result.png',
      storagePath: 'uuid-1/2026-06-04/result.png',
      filename: 'uuid-1/2026-06-04/result.png',
      uuid: 'uuid-1',
    });
  });

  it('valida prompt, uuid, archivo, tipo y tamano para editar con imagen', async () => {
    const factory = buildFactory({
      getProvider: () => ({ name: 'flux', edit: jest.fn() }) as any,
    });
    const service = new ImageService(llm as any, storage as any, config, factory);

    await expect(
      service.generateImageWithFile({ prompt: '', uuid: 'uuid-1' }, validFile),
    ).rejects.toThrow();
    await expect(
      service.generateImageWithFile({ prompt: 'ok', uuid: '' }, validFile),
    ).rejects.toThrow();
    await expect(
      service.generateImageWithFile({ prompt: 'ok', uuid: 'uuid-1' }, undefined as any),
    ).rejects.toThrow();
    await expect(
      service.generateImageWithFile(
        { prompt: 'ok', uuid: 'uuid-1' },
        { ...validFile, mimetype: 'text/plain' },
      ),
    ).rejects.toThrow();
    await expect(
      service.generateImageWithFile(
        { prompt: 'ok', uuid: 'uuid-1' },
        { ...validFile, size: 10 * 1024 * 1024 + 1 },
      ),
    ).rejects.toThrow();
  });

  it('hace fallback a OpenAI cuando Segmind falla y el fallback esta habilitado', async () => {
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

    const service = new ImageService(llm as any, storage as any, config, factory);
    const res = await service.generateAndStoreImage({ prompt: 'hola', uuid: 'uuid-1' });

    expect(segmind.generate).toHaveBeenCalledTimes(1);
    expect(openai.generate).toHaveBeenCalledTimes(1);
    expect(res.uuid).toBe('uuid-1');
  });

  it('NO hace fallback cuando esta deshabilitado', async () => {
    const segmind = { name: 'segmind', generate: jest.fn().mockRejectedValue(new Error('boom')) };
    const openai = { name: 'openai', generate: jest.fn() };
    const factory = buildFactory({
      getProvider: () => segmind as any,
      getFallbackProvider: () => openai as any,
      isFallbackEnabled: () => false,
    });

    const service = new ImageService(llm as any, storage as any, config, factory);
    await expect(service.generateAndStoreImage({ prompt: 'hola', uuid: 'uuid-1' })).rejects.toThrow();
    expect(openai.generate).not.toHaveBeenCalled();
  });

  it('un fallo de Anillustrious cae a OpenAI con el prompt original sin flag', async () => {
    const animePrompt = 'a cute anime girl with long pink hair';
    const anillustrious = {
      name: 'anillustrious',
      generate: jest.fn().mockRejectedValue(new Error('replicate down')),
    };
    const openai = {
      name: 'openai',
      generate: jest.fn().mockResolvedValue({ ...segmindResult, provider: 'openai' }),
    };
    const factory = buildFactory({
      getProvider: () => anillustrious as any,
      getFallbackProvider: () => openai as any,
      isFallbackEnabled: () => false,
    });

    const service = new ImageService(llm as any, storage as any, config, factory);
    const res = await service.generateAndStoreImage({ prompt: animePrompt, uuid: 'uuid-1' });

    expect(anillustrious.generate).toHaveBeenCalledTimes(1);
    expect(openai.generate).toHaveBeenCalledTimes(1);
    expect(res.uuid).toBe('uuid-1');

    const fallbackInput = openai.generate.mock.calls[0][0];
    expect(fallbackInput.prompt).toBe(animePrompt);
    expect(fallbackInput.prompt).not.toContain('1girl');
  });
});
