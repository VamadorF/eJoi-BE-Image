import { ConfigService } from '@nestjs/config';
import { AnillustriousImageProvider } from './anillustrious-image.provider';
import { AnillustriousPromptTransformer } from './anillustrious-prompt.transformer';

const SENTINEL_TAGS = '1girl, solo, sentinel tag, anime style';

function makeConfig(
  overrides: Record<string, string | undefined> = {},
): ConfigService {
  const base: Record<string, string | undefined> = {
    REPLICATE_API_KEY: 'test-key',
    ...overrides,
  };
  return { get: (key: string) => base[key] } as unknown as ConfigService;
}

/** Transformer stub que devuelve un sentinel para verificar el paso de tags. */
function makeTransformer(returnValue = SENTINEL_TAGS) {
  return {
    convertToAnillustriousTags: jest.fn().mockReturnValue(returnValue),
  } as unknown as AnillustriousPromptTransformer;
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

/** Encadena el happy-path: version → create → poll(succeeded) → download. */
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
      makeTransformer(),
    );
    await expect(provider.generate({ prompt: 'anime girl' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envía a Replicate el prompt CONVERTIDO a tags (no el original)', async () => {
    mockHappyPath(fetchMock);
    const transformer = makeTransformer();
    const provider = new AnillustriousImageProvider(makeConfig(), transformer);

    await provider.generate({ prompt: 'a young woman in a red dress' });

    // El transformer recibió el prompt original.
    expect(transformer.convertToAnillustriousTags).toHaveBeenCalledWith(
      'a young woman in a red dress',
    );

    // El body de la predicción usa los tags convertidos.
    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(createBody.input.prompt).toBe(SENTINEL_TAGS);
    expect(createBody.version).toBe('ver-123');
    expect(createBody.input.model).toBe('Anillustrious-v4');
  });

  it('NO muta el objeto request original (input.prompt intacto)', async () => {
    mockHappyPath(fetchMock);
    const provider = new AnillustriousImageProvider(makeConfig(), makeTransformer());

    const input = { prompt: 'an anime girl with blue hair', uuid: 'u-1' };
    await provider.generate(input);

    expect(input.prompt).toBe('an anime girl with blue hair');
  });

  it('normaliza la salida a base64 con metadata del provider', async () => {
    mockHappyPath(fetchMock);
    const provider = new AnillustriousImageProvider(makeConfig(), makeTransformer());

    const result = await provider.generate({
      prompt: 'anime girl',
      uuid: 'u-1',
      userId: 'usr-1',
      companionId: 'cmp-1',
      aspectRatio: '16:9',
    });

    expect(result.provider).toBe('anillustrious');
    expect(result.model).toBe('aisha-ai-official/anillustrious-v4');
    expect(result.contentType).toBe('image/png');
    expect(result.b64).toBe(
      Buffer.from(new Uint8Array(16).fill(1)).toString('base64'),
    );
    expect(result.uuid).toBe('u-1');

    // 16:9 → 1344x768; defaults de steps/cfg/scheduler.
    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(createBody.input.width).toBe(1344);
    expect(createBody.input.height).toBe(768);
    expect(createBody.input.steps).toBe(16);
    expect(createBody.input.cfg_scale).toBe(7);
    expect(createBody.input.scheduler).toBe('LCMScheduler Karras');
    expect(createBody.input.negative_prompt).toBeUndefined();
  });

  it('lanza error cuando la predicción falla', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ latest_version: { id: 'ver-123' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'pred-1', status: 'starting' }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 'pred-1', status: 'failed', error: 'boom' }),
      );
    const provider = new AnillustriousImageProvider(makeConfig(), makeTransformer());

    await expect(provider.generate({ prompt: 'anime' })).rejects.toThrow();
  });
});
