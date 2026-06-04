import { ConfigService } from '@nestjs/config';
import { SegmindImageProvider } from './segmind-image.provider';

// base64 lo bastante largo para pasar el heurístico looksLikeBase64 (>=100 chars)
const LONG_B64 = Buffer.from('x'.repeat(200)).toString('base64');

function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
  const base: Record<string, string | undefined> = {
    SEGMIND_API_KEY: 'test-key',
    ...overrides,
  };
  return { get: (key: string) => base[key] } as unknown as ConfigService;
}

function jsonResponse(body: any): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function imageResponse(bytes = 10): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => new Uint8Array(bytes).fill(1).buffer,
  } as unknown as Response;
}

describe('SegmindImageProvider', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it('lanza error claro si falta SEGMIND_API_KEY', async () => {
    const provider = new SegmindImageProvider(makeConfig({ SEGMIND_API_KEY: undefined }));
    await expect(provider.generate({ prompt: 'hola' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envía el header x-api-key y Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ image: LONG_B64 }));
    const provider = new SegmindImageProvider(makeConfig());

    await provider.generate({ prompt: 'un zorro' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('test-key');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('construye el body con prompt, negative_prompt y aspect_ratio por defecto', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ image: LONG_B64 }));
    const provider = new SegmindImageProvider(makeConfig());

    await provider.generate({ prompt: 'un zorro' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt).toBe('un zorro');
    expect(body.aspect_ratio).toBe('16:9'); // default sugerido
    expect(body.negative_prompt).toBe('blurry, pixelated, ugly, distorted, low quality');
  });

  it('usa el aspect_ratio del input cuando es válido', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ image: LONG_B64 }));
    const provider = new SegmindImageProvider(makeConfig());

    await provider.generate({ prompt: 'x', aspectRatio: '1:1' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.aspect_ratio).toBe('1:1');
  });

  it('rechaza aspect_ratio inválido y cae a 1:1', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ image: LONG_B64 }));
    const provider = new SegmindImageProvider(
      makeConfig({ SEGMIND_DEFAULT_ASPECT_RATIO: '21:9' }),
    );

    await provider.generate({ prompt: 'x' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.aspect_ratio).toBe('1:1');
  });

  it('parsea base64 desde un campo JSON conocido', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ b64: LONG_B64 }));
    const provider = new SegmindImageProvider(makeConfig());

    const result = await provider.generate({ prompt: 'x' });

    expect(result.b64).toBe(LONG_B64);
    expect(result.provider).toBe('segmind');
    expect(result.model).toBe('imagen-4-fast');
  });

  it('descarga la imagen cuando el JSON trae una URL', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ image: 'https://cdn.segmind.com/out.png' }))
      .mockResolvedValueOnce(imageResponse(16));
    const provider = new SegmindImageProvider(makeConfig());

    const result = await provider.generate({ prompt: 'x' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://cdn.segmind.com/out.png');
    expect(result.contentType).toBe('image/png');
    expect(result.b64.length).toBeGreaterThan(0);
  });
});
