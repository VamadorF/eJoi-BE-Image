import { ConfigService } from '@nestjs/config';
import { AnillustriousImageProvider } from './anillustrious-image.provider';

function makeConfig(
  overrides: Record<string, string | undefined> = {},
): ConfigService {
  const base: Record<string, string | undefined> = {
    REPLICATE_API_KEY: 'test-key',
    ...overrides,
  };
  return { get: (key: string) => base[key] } as unknown as ConfigService;
}

function jsonResponse(body: any): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function imageResponse(bytes = 16): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === 'content-type' ? 'image/png' : null,
    },
    arrayBuffer: async () => new Uint8Array(bytes).fill(1).buffer,
  } as unknown as Response;
}

const OUTPUT_URL = 'https://replicate.delivery/out.png';

/** Encadena las 4 respuestas del happy-path: version → create → poll → download. */
function mockHappyPath(fetchMock: jest.Mock) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ latest_version: { id: 'ver-123' } }))
    .mockResolvedValueOnce(jsonResponse({ id: 'pred-1', status: 'starting' }))
    .mockResolvedValueOnce(
      jsonResponse({ id: 'pred-1', status: 'succeeded', output: [OUTPUT_URL] }),
    )
    .mockResolvedValueOnce(imageResponse());
}

describe('AnillustriousImageProvider', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it('lanza error claro si falta REPLICATE_API_KEY', async () => {
    const provider = new AnillustriousImageProvider(
      makeConfig({ REPLICATE_API_KEY: undefined }),
    );
    await expect(provider.generate({ prompt: 'anime girl' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resuelve versión, crea predicción y normaliza la salida a base64', async () => {
    mockHappyPath(fetchMock);
    const provider = new AnillustriousImageProvider(makeConfig());

    const result = await provider.generate({
      prompt: 'anime girl',
      uuid: 'u-1',
      userId: 'usr-1',
      companionId: 'cmp-1',
    });

    expect(result.provider).toBe('anillustrious');
    expect(result.model).toBe('aisha-ai-official/anillustrious-v4');
    expect(result.contentType).toBe('image/png');
    expect(result.b64).toBe(Buffer.from(new Uint8Array(16).fill(1)).toString('base64'));
    expect(result.uuid).toBe('u-1');
    expect(result.userId).toBe('usr-1');
    expect(result.companionId).toBe('cmp-1');

    // 4 llamadas: model lookup, create, poll, download.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][0]).toBe(OUTPUT_URL);
  });

  it('envía la versión resuelta y el input según el schema del modelo', async () => {
    mockHappyPath(fetchMock);
    const provider = new AnillustriousImageProvider(makeConfig());

    await provider.generate({ prompt: 'anime girl', aspectRatio: '16:9' });

    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(createBody.version).toBe('ver-123');
    expect(createBody.input.model).toBe('Anillustrious-v4');
    expect(createBody.input.prompt).toBe('anime girl');
    expect(createBody.input.steps).toBe(16);
    expect(createBody.input.cfg_scale).toBe(7);
    expect(createBody.input.scheduler).toBe('LCMScheduler Karras');
    // 16:9 → 1344x768
    expect(createBody.input.width).toBe(1344);
    expect(createBody.input.height).toBe(768);
    // sin negative_prompt configurado → no se envía (usa default del modelo)
    expect(createBody.input.negative_prompt).toBeUndefined();
  });

  it('usa dimensiones 1:1 por defecto y respeta overrides de config', async () => {
    mockHappyPath(fetchMock);
    const provider = new AnillustriousImageProvider(
      makeConfig({
        ANILLUSTRIOUS_STEPS: '24',
        ANILLUSTRIOUS_CFG_SCALE: '5.5',
        ANILLUSTRIOUS_SCHEDULER: 'Euler a',
        ANILLUSTRIOUS_NEGATIVE_PROMPT: 'low quality',
      }),
    );

    await provider.generate({ prompt: 'manga hero' });

    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(createBody.input.width).toBe(1024);
    expect(createBody.input.height).toBe(1024);
    expect(createBody.input.steps).toBe(24);
    expect(createBody.input.cfg_scale).toBe(5.5);
    expect(createBody.input.scheduler).toBe('Euler a');
    expect(createBody.input.negative_prompt).toBe('low quality');
  });

  it('prioriza negativePrompt del input sobre la config', async () => {
    mockHappyPath(fetchMock);
    const provider = new AnillustriousImageProvider(
      makeConfig({ ANILLUSTRIOUS_NEGATIVE_PROMPT: 'from-env' }),
    );

    await provider.generate({ prompt: 'anime', negativePrompt: 'from-input' });

    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(createBody.input.negative_prompt).toBe('from-input');
  });

  it('lanza error cuando la predicción falla', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ latest_version: { id: 'ver-123' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'pred-1', status: 'starting' }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 'pred-1', status: 'failed', error: 'boom' }),
      );
    const provider = new AnillustriousImageProvider(makeConfig());

    await expect(provider.generate({ prompt: 'anime' })).rejects.toThrow();
  });
});
