import type { BusinessHarnessRunEvent, BusinessHarnessRunResult } from './businessHarnessContracts'
import { BusinessHarnessClientError } from './businessHarnessTransportError'

export async function readBusinessHarnessNdjson(
  stream: AsyncIterable<Uint8Array>,
  options: {
    maxBytes: number
    onEvent?: (event: BusinessHarnessRunEvent) => void | Promise<void>
  },
): Promise<BusinessHarnessRunResult> {
  const decoder = new TextDecoder()
  let buffer = ''
  let bytes = 0
  let result: BusinessHarnessRunResult | null = null

  for await (const chunk of stream) {
    bytes += chunk.byteLength
    if (bytes > options.maxBytes) {
      throw new BusinessHarnessClientError(
        'HARNESS_RESPONSE_TOO_LARGE',
        'Business harness response exceeded its limit',
      )
    }
    buffer += decoder.decode(chunk, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) result = await consumeLine(line, options.onEvent, result)
      newline = buffer.indexOf('\n')
    }
  }

  const tail = `${buffer}${decoder.decode()}`.trim()
  if (tail) result = await consumeLine(tail, options.onEvent, result)
  if (!result) {
    throw new BusinessHarnessClientError(
      'HARNESS_PROTOCOL_ERROR',
      'Business harness returned no terminal result',
    )
  }
  return result
}

async function consumeLine(
  line: string,
  onEvent: ((event: BusinessHarnessRunEvent) => void | Promise<void>) | undefined,
  currentResult: BusinessHarnessRunResult | null,
): Promise<BusinessHarnessRunResult | null> {
  let frame: unknown
  try {
    frame = JSON.parse(line)
  } catch (error) {
    throw new BusinessHarnessClientError(
      'HARNESS_PROTOCOL_ERROR',
      'Business harness returned invalid NDJSON',
      { cause: error },
    )
  }
  if (!isRecord(frame) || typeof frame.kind !== 'string') {
    throw new BusinessHarnessClientError(
      'HARNESS_PROTOCOL_ERROR',
      'Business harness returned an invalid frame',
    )
  }
  if (frame.kind === 'event') {
    if (currentResult) {
      throw new BusinessHarnessClientError(
        'HARNESS_PROTOCOL_ERROR',
        'Business harness returned an event after its terminal result',
      )
    }
    if (!isRecord(frame.event) || typeof frame.event.type !== 'string') {
      throw new BusinessHarnessClientError(
        'HARNESS_PROTOCOL_ERROR',
        'Business harness returned an invalid event',
      )
    }
    await onEvent?.(frame.event as BusinessHarnessRunEvent)
    return null
  }
  if (frame.kind === 'error') {
    const error = isRecord(frame.error) ? frame.error : {}
    throw new BusinessHarnessClientError(
      typeof error.code === 'string' ? error.code : 'HARNESS_RUN_FAILED',
      typeof error.message === 'string' ? error.message : 'Business harness run failed',
    )
  }
  if (frame.kind === 'result' && isRecord(frame.result)) {
    if (currentResult) {
      throw new BusinessHarnessClientError(
        'HARNESS_PROTOCOL_ERROR',
        'Business harness returned more than one terminal result',
      )
    }
    return frame.result as BusinessHarnessRunResult
  }
  throw new BusinessHarnessClientError(
    'HARNESS_PROTOCOL_ERROR',
    `Unknown business harness frame: ${frame.kind}`,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
