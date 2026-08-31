import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { HarnessError } from '../errors.js';
import type { CliStdioConnectorConfig } from '../config.js';
import { resolveCredentialSource } from '../credentials/sources.js';
import type {
  CapabilityLogSink,
  CapabilityProvider,
  CapabilitySession,
  CapabilityTool,
  OpenCapabilitySessionOptions,
} from './types.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abortListener?: () => void;
}

export class CliStdioCapabilityProvider implements CapabilityProvider {
  constructor(private readonly log?: CapabilityLogSink) {}

  async open(options: OpenCapabilitySessionOptions): Promise<CapabilitySession> {
    if (options.config.driver !== 'cli-stdio') {
      throw new HarnessError('CONFIGURATION_ERROR', 'CLI provider received a non-CLI connector');
    }
    return CliStdioSession.start(options.config, options, this.log);
  }
}

class CliStdioSession implements CapabilitySession {
  private nextId = 1;
  private buffer = '';
  private closed = false;
  private readonly pending = new Map<number, PendingRequest>();

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly config: CliStdioConnectorConfig,
    private readonly connectorId: string,
    private readonly sensitiveValues: readonly string[],
    private readonly log?: CapabilityLogSink,
  ) {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      const message = redactSensitive(chunk.trim(), this.sensitiveValues).slice(0, 2000);
      if (message) this.log?.({ level: 'debug', connectorId, message });
    });
    child.on('error', (error) => this.failAll(error));
    child.on('exit', (code, signal) => {
      if (!this.closed) {
        this.failAll(
          new HarnessError(
            'CONNECTOR_FAILED',
            `CLI connector exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
          ),
        );
      }
    });
  }

  static async start(
    config: CliStdioConnectorConfig,
    options: OpenCapabilitySessionOptions,
    log?: CapabilityLogSink,
  ): Promise<CliStdioSession> {
    const credentialEnvironment = Object.fromEntries(
      Object.entries(config.credentialEnv ?? {}).map(([name, source]) => [
        name,
        resolveCredentialSource(source, options.credential),
      ]),
    );
    const child = spawn(config.command, config.args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
        ...(process.env.LC_ALL ? { LC_ALL: process.env.LC_ALL } : {}),
        ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
        ...credentialEnvironment,
      },
    });
    const session = new CliStdioSession(
      child,
      config,
      options.connectorId,
      [
        options.credential.value,
        ...Object.values(options.credential.metadata).filter(
          (value): value is string => typeof value === 'string',
        ),
      ],
      log,
    );
    try {
      await session.request(
        'initialize',
        {
          protocolVersion: '1',
          client: { name: 'openmercato-business-agent-runtime', version: '0.1.0' },
          run: { id: options.runId },
        },
        config.startupTimeoutMs,
        options.signal,
      );
      return session;
    } catch (error) {
      await session.close().catch(() => undefined);
      throw new HarnessError('CONNECTOR_FAILED', 'Could not initialize CLI connector', { cause: error });
    }
  }

  async listTools(signal?: AbortSignal): Promise<CapabilityTool[]> {
    const result = await this.request('tools/list', {}, this.config.requestTimeoutMs, signal);
    if (!isRecord(result) || !Array.isArray(result.tools)) {
      throw new HarnessError('CONNECTOR_FAILED', 'CLI tools/list returned an invalid result');
    }
    return result.tools.map(parseTool);
  }

  async callTool(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.request(
      'tools/call',
      { name, arguments: input },
      this.config.requestTimeoutMs,
      signal,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.child.exitCode === null) {
        await this.request('shutdown', {}, 1000).catch(() => undefined);
      }
    } finally {
      if (this.child.exitCode === null) this.child.kill('SIGTERM');
      this.failAll(new HarnessError('CONNECTOR_FAILED', 'CLI connector session closed'));
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.closed && method !== 'shutdown') {
      return Promise.reject(new HarnessError('CONNECTOR_FAILED', 'CLI connector is closed'));
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HarnessError('CONNECTOR_FAILED', `CLI request ${method} timed out`));
      }, timeoutMs);
      timer.unref();
      const pending: PendingRequest = { resolve, reject, timer, ...(signal ? { signal } : {}) };
      if (signal) {
        const abortListener = () => {
          this.cleanupPending(id);
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        pending.abortListener = abortListener;
        signal.addEventListener('abort', abortListener, { once: true });
      }
      this.pending.set(id, pending);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (error) {
          this.cleanupPending(id);
          reject(new HarnessError('CONNECTOR_FAILED', `Could not write CLI request ${method}`, { cause: error }));
        }
      });
    });
  }

  private consumeStdout(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > this.config.maxLineBytes) {
      this.failAll(new HarnessError('CONNECTOR_FAILED', 'CLI connector exceeded maximum line size'));
      this.child.kill('SIGTERM');
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      this.consumeLine(line);
    }
  }

  private consumeLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.failAll(new HarnessError('CONNECTOR_FAILED', 'CLI connector wrote non-JSON data to stdout', { cause: error }));
      return;
    }
    if (!isRecord(message) || typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.cleanupPending(message.id);
    if ('error' in message) {
      pending.reject(new HarnessError('CONNECTOR_FAILED', 'CLI connector returned an error response'));
    } else {
      pending.resolve(message.result);
    }
  }

  private cleanupPending(id: number): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
    this.pending.delete(id);
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.cleanupPending(id);
      pending.reject(error);
    }
  }
}

function parseTool(value: unknown): CapabilityTool {
  if (!isRecord(value) || typeof value.name !== 'string' || !isRecord(value.inputSchema)) {
    throw new HarnessError('CONNECTOR_FAILED', 'CLI connector returned an invalid tool definition');
  }
  const annotations = isRecord(value.annotations)
    ? {
        ...(typeof value.annotations.readOnlyHint === 'boolean'
          ? { readOnlyHint: value.annotations.readOnlyHint }
          : {}),
        ...(typeof value.annotations.destructiveHint === 'boolean'
          ? { destructiveHint: value.annotations.destructiveHint }
          : {}),
        ...(typeof value.annotations.idempotentHint === 'boolean'
          ? { idempotentHint: value.annotations.idempotentHint }
          : {}),
        ...(typeof value.annotations.openWorldHint === 'boolean'
          ? { openWorldHint: value.annotations.openWorldHint }
          : {}),
      }
    : undefined;
  return {
    name: value.name,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    inputSchema: value.inputSchema,
    ...(isRecord(value.outputSchema) ? { outputSchema: value.outputSchema } : {}),
    ...(annotations ? { annotations } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactSensitive(message: string, sensitiveValues: readonly string[]): string {
  return sensitiveValues
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((redacted, value) => redacted.split(value).join('[REDACTED]'), message);
}

