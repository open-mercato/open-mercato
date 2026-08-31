import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { BusinessAgentRuntime } from './runtime/runtime.js';
import { HarnessError, publicError, toHarnessError } from './errors.js';

export interface HarnessHttpServerOptions {
  runtime: BusinessAgentRuntime;
  serviceToken: string;
  maxRequestBytes?: number;
}

export function createHarnessHttpServer(options: HarnessHttpServerOptions): Server {
  const maxRequestBytes = options.maxRequestBytes ?? 10_000_000;
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/healthz') {
        sendJson(response, 200, { status: 'ok', service: 'openmercato-business-agent-runtime' });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/v1/runs') {
        sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
        return;
      }
      authenticate(request, options.serviceToken);
      const input = await readJsonBody(request, maxRequestBytes);
      const abortController = new AbortController();
      request.once('aborted', () => abortController.abort(new DOMException('Client aborted', 'AbortError')));
      response.once('close', () => {
        if (!response.writableEnded) {
          abortController.abort(new DOMException('Client disconnected', 'AbortError'));
        }
      });

      if (acceptsNdjson(request)) {
        response.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        try {
          const result = await options.runtime.run(input, {
            signal: abortController.signal,
            onEvent: (event) => writeNdjson(response, { kind: 'event', event }),
          });
          await writeNdjson(response, { kind: 'result', result });
        } catch (error) {
          if (!response.destroyed) {
            await writeNdjson(response, { kind: 'error', error: publicError(error) });
          }
        } finally {
          response.end();
        }
        return;
      }

      const result = await options.runtime.run(input, { signal: abortController.signal });
      sendJson(response, 200, result);
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const normalized = toHarnessError(error);
      sendJson(response, normalized.statusCode, { error: publicError(normalized) });
    }
  });
}

function authenticate(request: IncomingMessage, expectedToken: string): void {
  const authorization = request.headers.authorization;
  const prefix = 'Bearer ';
  if (!authorization?.startsWith(prefix)) {
    throw new HarnessError('AUTHENTICATION_FAILED', 'Missing harness service token');
  }
  const actual = Buffer.from(authorization.slice(prefix.length));
  const expected = Buffer.from(expectedToken);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new HarnessError('AUTHENTICATION_FAILED', 'Invalid harness service token');
  }
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new HarnessError('INVALID_REQUEST', 'Request body is too large', { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new HarnessError('INVALID_REQUEST', 'Request body must contain valid JSON', { cause: error });
  }
}

function acceptsNdjson(request: IncomingMessage): boolean {
  return request.headers.accept?.split(',').some((value) => value.trim() === 'application/x-ndjson') ?? false;
}

async function writeNdjson(response: ServerResponse, value: unknown): Promise<void> {
  if (!response.write(`${JSON.stringify(value)}\n`)) await once(response, 'drain');
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

