import type {
  BusinessHarnessExecutionBundle,
  BusinessHarnessRunResult,
} from './businessHarnessContracts'
import { readBusinessHarnessNdjson } from './businessHarnessNdjson'
import type { BusinessHarnessRunOptions, BusinessHarnessTransport } from './businessHarnessTransport'
export { BusinessHarnessClientError } from './businessHarnessTransportError'
import { BusinessHarnessClientError } from './businessHarnessTransportError'

const DEFAULT_MAX_RESPONSE_BYTES = 10_000_000

export type BusinessHarnessClientOptions = {
  baseUrl?: string
  serviceToken?: string
  fetchImplementation?: typeof fetch
  maxResponseBytes?: number
}

export class BusinessHarnessClient implements BusinessHarnessTransport {
  private readonly baseUrl: string
  private readonly serviceToken: string
  private readonly fetchImplementation: typeof fetch
  private readonly maxResponseBytes: number

  constructor(options: BusinessHarnessClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveHarnessUrl()).replace(/\/+$/, '')
    this.serviceToken = options.serviceToken ?? resolveHarnessServiceToken()
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  }

  async run(
    bundle: BusinessHarnessExecutionBundle,
    options: BusinessHarnessRunOptions = {},
  ): Promise<BusinessHarnessRunResult> {
    let response: Response
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/v1/runs`, {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          authorization: `Bearer ${this.serviceToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(bundle),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (error) {
      throw new BusinessHarnessClientError('HARNESS_UNAVAILABLE', 'Business harness request failed', {
        cause: error,
      })
    }
    if (!response.ok || !response.body) {
      throw new BusinessHarnessClientError(
        'HARNESS_REJECTED',
        `Business harness rejected the run with HTTP ${response.status}`,
        { status: response.status },
      )
    }

    return readBusinessHarnessNdjson(
      response.body as unknown as AsyncIterable<Uint8Array>,
      {
        maxBytes: this.maxResponseBytes,
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      },
    )
  }
}

function resolveHarnessUrl(): string {
  return process.env.OM_BUSINESS_HARNESS_URL?.trim() || 'http://127.0.0.1:4300'
}

/** Documented local-development fallback, published in this repository's compose files and docs. */
const LOCAL_DEVELOPMENT_SERVICE_TOKEN = 'open-mercato-business-harness-local-token'

function resolveHarnessServiceToken(): string {
  const configured = process.env.BUSINESS_HARNESS_SERVICE_TOKEN?.trim()
  if (process.env.NODE_ENV === 'production' && (!configured || configured === LOCAL_DEVELOPMENT_SERVICE_TOKEN)) {
    throw new BusinessHarnessClientError(
      'HARNESS_CONFIGURATION_ERROR',
      'BUSINESS_HARNESS_SERVICE_TOKEN must be set to a generated secret in production',
    )
  }
  return configured || LOCAL_DEVELOPMENT_SERVICE_TOKEN
}
