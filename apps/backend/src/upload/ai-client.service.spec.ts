import type { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AiClientService,
  AiPreviewNotFoundError
} from '@/upload/ai-client.service';
import type { AIProcessUpdate } from '@/upload/ai-protocol.types';
import type { Env } from '@/utils/env.validation';

const BASE_URL = 'http://ai.test:8000';

function makeClient(
  overrides: Partial<Record<keyof Env, string>> = {}
): AiClientService {
  const values: Record<string, string> = {
    AI_SERVICE_URL: BASE_URL,
    AI_TRANSFER_MODE: 'path',
    AI_INTERNAL_TOKEN: '',
    ...overrides
  };
  const configService = {
    get: (key: string) => values[key]
  } as unknown as ConfigService<Env, true>;
  return new AiClientService(configService);
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

async function collect(
  source: AsyncGenerator<AIProcessUpdate>
): Promise<AIProcessUpdate[]> {
  const updates: AIProcessUpdate[] = [];
  for await (const update of source) {
    updates.push(update);
  }
  return updates;
}

describe('AiClientService', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('parses NDJSON progress updates from the stream', async () => {
    const ndjson =
      '{"status":"processing","progress":10,"currentFrame":1,"totalFrames":10}\n' +
      '{"status":"processing","progress":50}\n' +
      '{"status":"completed","jobId":"j1","progress":100,"fileSize":42}\n';
    fetchSpy.mockResolvedValue(new Response(ndjson, { status: 200 }));

    const client = makeClient();
    const updates = await collect(
      client.streamProcess({
        jobId: 'j1',
        inputPath: 'in.mp4',
        outputPath: 'out.mp4',
        signal: new AbortController().signal
      })
    );

    expect(updates).toEqual([
      { status: 'processing', progress: 10, currentFrame: 1, totalFrames: 10 },
      { status: 'processing', progress: 50 },
      { status: 'completed', jobId: 'j1', progress: 100, fileSize: 42 }
    ]);
  });

  it('sends a bearer token when AI_INTERNAL_TOKEN is configured', async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"status":"completed","jobId":"j","progress":100}\n', {
        status: 200
      })
    );

    const client = makeClient({ AI_INTERNAL_TOKEN: 'secret-token' });
    await collect(
      client.streamProcess({
        jobId: 'j',
        inputPath: 'in.mp4',
        outputPath: 'out.mp4',
        signal: new AbortController().signal
      })
    );

    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe(`${BASE_URL}/process`);
    expect(headersOf(call?.[1])['Authorization']).toBe('Bearer secret-token');
  });

  it('omits the Authorization header when no token is configured', async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"status":"completed","jobId":"j","progress":100}\n', {
        status: 200
      })
    );

    const client = makeClient();
    await collect(
      client.streamProcess({
        jobId: 'j',
        inputPath: 'in.mp4',
        outputPath: 'out.mp4',
        signal: new AbortController().signal
      })
    );

    expect(headersOf(fetchSpy.mock.calls[0]?.[1])['Authorization']).toBeUndefined();
  });

  it('downloads a completed result and writes it to disk', async () => {
    const content = 'enhanced-video-bytes';
    fetchSpy.mockResolvedValue(new Response(content, { status: 200 }));

    const client = makeClient({
      AI_TRANSFER_MODE: 'remote',
      AI_INTERNAL_TOKEN: 'secret-token'
    });
    const destPath = path.join(
      os.tmpdir(),
      `ai-client-result-${String(Date.now())}.mp4`
    );

    try {
      await client.downloadResult({
        downloadPath: '/result/j',
        destPath,
        signal: new AbortController().signal
      });

      const call = fetchSpy.mock.calls[0];
      expect((call?.[0] as URL).href).toBe(`${BASE_URL}/result/j`);
      expect(headersOf(call?.[1])['Authorization']).toBe('Bearer secret-token');
      expect(fs.readFileSync(destPath, 'utf8')).toBe(content);
    } finally {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    }
  });

  it('refuses a result download URL that is not a same-origin /result path', async () => {
    fetchSpy.mockResolvedValue(new Response('owned', { status: 200 }));

    const client = makeClient({ AI_TRANSFER_MODE: 'remote' });
    await expect(
      client.downloadResult({
        downloadPath: '//169.254.169.254/latest/meta-data/',
        destPath: path.join(os.tmpdir(), 'never-written.bin'),
        signal: new AbortController().signal
      })
    ).rejects.toThrow(/unexpected URL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws when result download responds with a non-OK status', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 404 }));

    const client = makeClient({ AI_TRANSFER_MODE: 'remote' });
    await expect(
      client.downloadResult({
        downloadPath: '/result/missing',
        destPath: path.join(os.tmpdir(), 'never-written.mp4'),
        signal: new AbortController().signal
      })
    ).rejects.toThrow(/AI result download failed/);
  });

  it('throws AiPreviewNotFoundError when the AI has no such preview frame', async () => {
    fetchSpy.mockResolvedValue(new Response('missing', { status: 404 }));

    const client = makeClient();
    await expect(
      client.downloadPreview({
        downloadPath: '/preview/j/42',
        destPath: path.join(os.tmpdir(), 'never-written.jpg'),
        signal: new AbortController().signal
      })
    ).rejects.toBeInstanceOf(AiPreviewNotFoundError);
  });

  it('throws a generic error for non-404 preview download failures', async () => {
    fetchSpy.mockResolvedValue(new Response('boom', { status: 500 }));

    const client = makeClient();
    await expect(
      client.downloadPreview({
        downloadPath: '/preview/j/42',
        destPath: path.join(os.tmpdir(), 'never-written.jpg'),
        signal: new AbortController().signal
      })
    ).rejects.toThrow(/AI preview download failed/);
  });

  it('cancels with a token header and the jobId body when configured', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: 'cancelled', jobId: 'j' }), {
        status: 200
      })
    );

    const client = makeClient({ AI_INTERNAL_TOKEN: 'secret-token' });
    await client.cancel('j');

    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe(`${BASE_URL}/cancel`);
    expect(call?.[1]?.method).toBe('POST');
    expect(headersOf(call?.[1])['Authorization']).toBe('Bearer secret-token');
    expect(call?.[1]?.body).toBe(JSON.stringify({ jobId: 'j' }));
  });

  it('tolerates a 404 from the cancel bridge', async () => {
    fetchSpy.mockResolvedValue(new Response('not active', { status: 404 }));

    const client = makeClient();
    await expect(client.cancel('j')).resolves.toBeUndefined();
  });
});
