import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { HarnessError, publicError } from './errors.js';
import type { BusinessAgentRuntime } from './runtime/runtime.js';

export const DEFAULT_STDIO_MAX_INPUT_BYTES = 10_000_000;

export type StdioRunOutcome = 'completed' | 'failed';

export interface HarnessStdioOptions {
  runtime: Pick<BusinessAgentRuntime, 'run'>;
  input: Readable;
  output: Writable;
  signal?: AbortSignal;
  maxInputBytes?: number;
}

export async function runHarnessStdio(options: HarnessStdioOptions): Promise<StdioRunOutcome> {
  try {
    const input = await readJsonInput(
      options.input,
      options.maxInputBytes ?? DEFAULT_STDIO_MAX_INPUT_BYTES,
      options.signal,
    );
    const result = await options.runtime.run(input, {
      ...(options.signal ? { signal: options.signal } : {}),
      onEvent: (event) => writeStdioRecord(options.output, { kind: 'event', event }),
    });
    await writeStdioRecord(options.output, { kind: 'result', result });
    return 'completed';
  } catch (error) {
    await writeStdioRecord(options.output, { kind: 'error', error: publicError(error) });
    return 'failed';
  }
}

export async function writeStdioRecord(output: Writable, value: unknown): Promise<void> {
  if (!output.write(`${JSON.stringify(value)}\n`)) await once(output, 'drain');
}

async function readJsonInput(
  input: Readable,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new HarnessError('CONFIGURATION_ERROR', 'stdio max input size must be a positive integer');
  }
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const chunks: Buffer[] = [];
  let size = 0;
  const abortListener = () => {
    input.destroy(asAbortError(signal?.reason));
  };
  signal?.addEventListener('abort', abortListener, { once: true });
  try {
    for await (const chunk of input) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        throw new HarnessError('INVALID_REQUEST', 'stdio input is too large', { statusCode: 413 });
      }
      chunks.push(buffer);
    }
  } finally {
    signal?.removeEventListener('abort', abortListener);
  }

  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (!body) throw new HarnessError('INVALID_REQUEST', 'stdin must contain one JSON request');
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new HarnessError('INVALID_REQUEST', 'stdin must contain one valid JSON request', {
      cause: error,
    });
  }
}

function asAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new DOMException('Aborted', 'AbortError');
}
