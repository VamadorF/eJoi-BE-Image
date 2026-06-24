import { ConfigService } from '@nestjs/config';
import { FluxImageProvider } from './flux-image.provider';

interface FluxRequestBody {
  input: {
    prompt: string;
    aspect_ratio: string;
    output_format: string;
  };
}

function makeConfig(
  overrides: Record<string, string | undefined> = {},
): ConfigService {
  const values: Record<string, string | undefined> = {
    REPLICATE_API_KEY: 'test-key',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function imageResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'image/webp' },
    arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
  } as unknown as Response;
}

function requestBody(
  fetchMock: jest.MockedFunction<typeof fetch>,
  callIndex: number,
): FluxRequestBody {
  const init: unknown = fetchMock.mock.calls[callIndex]?.[1];
  if (
    !init ||
    typeof init !== 'object' ||
    !('body' in init) ||
    typeof init.body !== 'string'
  ) {
    throw new Error(`Missing request body for fetch call ${callIndex}`);
  }

  const parsed: unknown = JSON.parse(init.body);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('input' in parsed) ||
    !parsed.input ||
    typeof parsed.input !== 'object'
  ) {
    throw new Error(`Invalid Flux request body for fetch call ${callIndex}`);
  }
  return parsed as FluxRequestBody;
}

describe('FluxImageProvider', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    global.fetch = fetchMock;
  });

  afterEach(() => jest.restoreAllMocks());

  it('genera una imagen con el endpoint gestionado flux-2-pro', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ latest_version: { id: 'version-1' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'prediction-1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'prediction-1',
          status: 'succeeded',
          output: 'https://cdn.example/image.webp',
        }),
      )
      .mockResolvedValueOnce(imageResponse());

    const provider = new FluxImageProvider(makeConfig());
    const result = await provider.generate({ prompt: 'un zorro' });

    const body = requestBody(fetchMock, 1);
    expect(body.input.prompt).toBe('un zorro');
    expect(body.input.aspect_ratio).toBe('1:1');
    expect(body.input.output_format).toBe('webp');
    // El endpoint gestionado no acepta go_fast (devolvería 422).
    expect('go_fast' in body.input).toBe(false);
    expect(result.provider).toBe('flux');
    expect(result.contentType).toBe('image/webp');
  });

  it('propaga errores de predicción no recuperables', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ latest_version: { id: 'version-1' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'prediction-1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'prediction-1',
          status: 'failed',
          error: 'NSFW content detected',
        }),
      );

    const provider = new FluxImageProvider(makeConfig());

    await expect(provider.generate({ prompt: 'un zorro' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
