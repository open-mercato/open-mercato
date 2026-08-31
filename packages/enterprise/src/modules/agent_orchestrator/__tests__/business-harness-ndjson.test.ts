/** @jest-environment node */
// The NDJSON reader is the only thing standing between a misbehaving harness process
// and the runner's persistence path, so a truncated, doubled or oversized stream must
// surface as a typed protocol failure rather than a silently accepted result.
import type { BusinessHarnessRunEvent } from '../lib/runtime/businessHarnessContracts'
import { readBusinessHarnessNdjson } from '../lib/runtime/businessHarnessNdjson'
import { BusinessHarnessClientError } from '../lib/runtime/businessHarnessTransportError'

const RUN = '11111111-1111-4111-8111-111111111111'

const RESULT = {
  protocolVersion: '1',
  status: 'completed',
  identity: {
    runId: RUN,
    agentId: 'deals.health_check',
    agentVersion: '0123456789abcdef',
    agentDigest: 'a'.repeat(64),
    runtimeProfile: 'business-v1',
    model: { bindingId: 'b', bindingRevision: 'r', driver: 'openai', modelId: 'gpt-5-mini' },
    connectors: ['open-mercato'],
    toolCatalogDigest: 'd',
  },
  output: { kind: 'researcher', data: { summary: 'ok' } },
  usage: { inputTokens: 10, outputTokens: 4 },
  steps: 2,
  toolCalls: 1,
  durationMs: 42,
}

function stream(chunks: string[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield new TextEncoder().encode(chunk)
    },
  }
}

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

async function read(chunks: string[], onEvent?: (event: BusinessHarnessRunEvent) => void) {
  return readBusinessHarnessNdjson(stream(chunks), {
    maxBytes: 10_000,
    ...(onEvent ? { onEvent } : {}),
  })
}

async function expectClientError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(BusinessHarnessClientError)
  await promise.catch((error: BusinessHarnessClientError) => {
    expect(error.code).toBe(code)
  })
}

describe('business harness NDJSON reader', () => {
  it('delivers events in order and returns the terminal result', async () => {
    const seen: string[] = []
    const result = await read(
      [
        line({ kind: 'event', event: { type: 'run.started', runId: RUN, timestamp: 'now' } }),
        line({ kind: 'event', event: { type: 'step.finished', runId: RUN, step: 0 } }),
        line({ kind: 'result', result: RESULT }),
      ],
      (event) => seen.push(event.type),
    )

    expect(seen).toEqual(['run.started', 'step.finished'])
    expect(result.identity.runId).toBe(RUN)
    expect(result.usage.inputTokens).toBe(10)
  })

  it('reassembles frames split across chunk boundaries', async () => {
    const encoded = line({ kind: 'result', result: RESULT })
    const cut = Math.floor(encoded.length / 2)
    const result = await read([encoded.slice(0, cut), encoded.slice(cut)])
    expect(result.identity.agentId).toBe('deals.health_check')
  })

  it('accepts a terminal result that arrives without a trailing newline', async () => {
    const encoded = line({ kind: 'result', result: RESULT }).trimEnd()
    const result = await read([encoded])
    expect(result.status).toBe('completed')
  })

  it('surfaces the harness error code from an error frame', async () => {
    await expectClientError(
      read([line({ kind: 'error', error: { code: 'POLICY_VIOLATION', message: 'nope' } })]),
      'POLICY_VIOLATION',
    )
  })

  it('fails when the stream ends without a terminal result', async () => {
    await expectClientError(
      read([line({ kind: 'event', event: { type: 'run.started', runId: RUN } })]),
      'HARNESS_PROTOCOL_ERROR',
    )
  })

  it('rejects invalid JSON, unknown frame kinds and malformed events', async () => {
    await expectClientError(read(['not json\n']), 'HARNESS_PROTOCOL_ERROR')
    await expectClientError(read([line({ kind: 'something-else' })]), 'HARNESS_PROTOCOL_ERROR')
    await expectClientError(read([line({ kind: 'event', event: { runId: RUN } })]), 'HARNESS_PROTOCOL_ERROR')
  })

  it('rejects a second result and any event that follows the terminal one', async () => {
    await expectClientError(
      read([line({ kind: 'result', result: RESULT }), line({ kind: 'result', result: RESULT })]),
      'HARNESS_PROTOCOL_ERROR',
    )
    await expectClientError(
      read([
        line({ kind: 'result', result: RESULT }),
        line({ kind: 'event', event: { type: 'run.completed', runId: RUN } }),
      ]),
      'HARNESS_PROTOCOL_ERROR',
    )
  })

  it('rejects a terminal result that is missing the fields the runner reads', async () => {
    await expectClientError(
      read([line({ kind: 'result', result: { protocolVersion: '1', status: 'completed' } })]),
      'HARNESS_PROTOCOL_ERROR',
    )
    await expectClientError(
      read([line({ kind: 'result', result: { ...RESULT, status: 'failed' } })]),
      'HARNESS_PROTOCOL_ERROR',
    )
    await expectClientError(
      read([line({ kind: 'result', result: { ...RESULT, identity: { runId: RUN } } })]),
      'HARNESS_PROTOCOL_ERROR',
    )
  })

  it('stops reading once the response exceeds its byte ceiling', async () => {
    const promise = readBusinessHarnessNdjson(stream([`${'x'.repeat(64)}\n`]), { maxBytes: 16 })
    await expectClientError(promise, 'HARNESS_RESPONSE_TOO_LARGE')
  })

  it('does not let a throwing event consumer be mistaken for a protocol failure', async () => {
    await expect(
      read([line({ kind: 'event', event: { type: 'run.started', runId: RUN } }), line({ kind: 'result', result: RESULT })], () => {
        throw new Error('observer blew up')
      }),
    ).rejects.toThrow('observer blew up')
  })
})
