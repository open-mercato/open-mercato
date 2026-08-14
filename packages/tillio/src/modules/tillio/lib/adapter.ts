import { z } from 'zod'
import type { PhoneCallProviderAdapter } from '@open-mercato/shared/modules/phone_calls/provider'
import type {
  FetchPhoneCallsInput,
  NormalizedPhoneCall,
  NormalizedPhoneCallBatch,
  ProviderValidationResult,
  ValidatePhoneCallProviderInput,
} from '@open-mercato/shared/modules/phone_calls/types'
import { TILLIO_PROVIDER_KEY } from '../integration'
import { TillioApiError } from './errors'
import { createTillioClient, type TillioClientDeps } from './client'
import { ENV_PROBE_TENANT_DOMAIN, environmentSchema } from './environment'
import { normalizeTillioCall } from './normalizer'
import { operatorPluginSchema } from './operators-store'
import { formatTillioTimestamp } from './tz'

export const TILLIO_DEFAULT_BATCH_LIMIT = 500

const pullCredentialsSchema = z.object({
  apiUrl: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
  tenantSystemId: z.string().trim().min(1),
  operator: z.object({
    id: z.string().trim().min(1),
    plugin: operatorPluginSchema,
    token: z.string().trim().min(1),
    tenantDomain: z.string().trim().min(1),
  }),
})

export type TillioPullCredentials = z.infer<typeof pullCredentialsSchema>

function parseCursor(cursor: string | null | undefined): number {
  if (!cursor) return 1
  const parsed = Number(cursor)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.trunc(parsed)
}

// `deps` only carries the outbound-fetch test seams down to the client; production builds
// the adapter without them and gets URL validation plus DNS pinning from `safeOutboundFetch`.
export function createTillioAdapter(deps: TillioClientDeps = {}): PhoneCallProviderAdapter {
  return {
    providerKey: TILLIO_PROVIDER_KEY,
    displayName: 'Tillio',

    async validateConnection(input: ValidatePhoneCallProviderInput): Promise<ProviderValidationResult> {
      const parsed = environmentSchema.safeParse(input.credentials)
      if (!parsed.success || !parsed.data.tenantSystemId) {
        return { ok: false, message: 'Tillio environment is not configured.' }
      }
      try {
        const client = createTillioClient({
          apiUrl: parsed.data.apiUrl,
          apiKey: parsed.data.apiKey,
          tenantSystemId: parsed.data.tenantSystemId,
        }, deps)
        await client.getPlugins(ENV_PROBE_TENANT_DOMAIN)
        return { ok: true }
      } catch (err) {
        const message = err instanceof TillioApiError || err instanceof Error ? err.message : 'Validation failed'
        return { ok: false, message }
      }
    },

    async fetchCalls(input: FetchPhoneCallsInput): Promise<NormalizedPhoneCallBatch> {
      const credentials = pullCredentialsSchema.parse(input.credentials)
      const { operator } = credentials
      const client = createTillioClient({
        apiUrl: credentials.apiUrl,
        apiKey: credentials.apiKey,
        tenantSystemId: credentials.tenantSystemId,
      }, deps)

      const from = input.from ? formatTillioTimestamp(input.from) : undefined
      const to = input.to ? formatTillioTimestamp(input.to) : undefined
      const limit = input.limit && input.limit > 0 ? Math.trunc(input.limit) : TILLIO_DEFAULT_BATCH_LIMIT

      const calls: NormalizedPhoneCall[] = []
      let page = parseCursor(input.cursor)
      let nextCursor: string | null = null

      while (true) {
        const response = await client.getCalls({
          tenantDomain: operator.tenantDomain,
          token: operator.token,
          from,
          to,
          page,
        })

        for (const rawCall of response.calls) {
          calls.push(normalizeTillioCall(rawCall, { operatorId: operator.id, plugin: operator.plugin }))
        }

        // Guards against a broken response, not against large ranges: a `page`
        // parameter the server ignored, a nonsensical `pages` count, or an empty
        // page before the last one would otherwise spin this loop forever.
        const { pages, page: echoedPage } = response.pagination
        if (echoedPage !== page) break
        if (pages < 1 || page >= pages) break
        if (response.calls.length === 0) break

        page += 1
        // The current page is always drained before stopping, so the cursor never
        // advances past calls we did not collect.
        if (calls.length >= limit) {
          nextCursor = String(page)
          break
        }
      }

      return { calls, nextCursor }
    },
  }
}

export const tillioAdapter: PhoneCallProviderAdapter = createTillioAdapter()
