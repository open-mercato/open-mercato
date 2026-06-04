import type { AwilixContainer } from 'awilix'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import type { ChannelAdapter, ContactHint, TenantScope } from './adapter'

/**
 * Contact resolver — used by the inbound bridge to attach an external sender
 * to a CRM person.
 *
 * Flow (SPEC-045d §8.1):
 *   1. If the adapter implements `resolveContact?(...)`, call it to get a
 *      provider-side ContactHint (display name, photo URL, possibly an email
 *      lookup the adapter performed against its own user directory).
 *   2. If the hint includes an email or phone, query the CRM (`customers:customer_entity`)
 *      via the **QueryEngine** (NOT raw SQL — root AGENTS.md mandate). If a person
 *      matches, populate `matchedPersonId` on the returned hint.
 *   3. Return the merged hint, or `null` if neither the adapter nor the CRM
 *      yields any identity information.
 */

export interface ContactResolverInput {
  adapter: ChannelAdapter
  senderIdentifier: string
  senderDisplayName?: string
  channelMetadata?: Record<string, unknown>
  credentials: Record<string, unknown>
  scope: TenantScope
}

export interface ResolveContactDeps {
  container: { resolve: <T = unknown>(name: string) => T }
}

type QueryEngineLike = {
  query: (
    entityType: string,
    options: {
      tenantId: string
      organizationId?: string | null
      filter?: Record<string, unknown>
      limit?: number
      offset?: number
    },
  ) => Promise<Record<string, unknown>[]>
}

/**
 * Resolve a CRM contact from an external sender identifier.
 *
 * Returns `null` when no identity could be derived. Callers MUST treat the
 * return value as advisory (a hint, not an authoritative match) — see spec
 * § 8 "Contact resolution false positive" risk.
 */
export async function resolveContact(
  input: ContactResolverInput,
  deps: ResolveContactDeps,
): Promise<ContactHint | null> {
  // Step 1 — adapter resolution (optional)
  const adapterHint: ContactHint | null = await runAdapterResolve(input)
  if (!adapterHint && !input.senderIdentifier) return null

  // Step 2 — CRM lookup by email or phone, via QueryEngine (no raw SQL).
  const lookupEmail = adapterHint?.email ?? heuristicEmail(input.senderIdentifier)
  const lookupPhone = adapterHint?.phone ?? heuristicPhone(input.senderIdentifier)

  let matchedPersonId: string | undefined
  if ((lookupEmail || lookupPhone) && deps.container) {
    matchedPersonId = await lookupCustomerPersonId({
      container: deps.container,
      scope: input.scope,
      email: lookupEmail,
      phone: lookupPhone,
    })
  }

  return {
    ...(adapterHint ?? {}),
    email: lookupEmail,
    phone: lookupPhone,
    displayName: adapterHint?.displayName ?? input.senderDisplayName,
    matchedPersonId: matchedPersonId ?? adapterHint?.matchedPersonId,
  }
}

async function runAdapterResolve(input: ContactResolverInput): Promise<ContactHint | null> {
  if (typeof input.adapter.resolveContact !== 'function') return null
  try {
    return (
      (await input.adapter.resolveContact({
        senderIdentifier: input.senderIdentifier,
        senderDisplayName: input.senderDisplayName,
        channelMetadata: input.channelMetadata,
        credentials: input.credentials,
        scope: input.scope,
      })) ?? null
    )
  } catch {
    // The adapter is best-effort. A failure does not block ingest; we just lose
    // the optional CRM match. Errors are not propagated.
    return null
  }
}

async function lookupCustomerPersonId(params: {
  container: ResolveContactDeps['container']
  scope: TenantScope
  email?: string
  phone?: string
}): Promise<string | undefined> {
  // Under tenant encryption, `primary_email`/`primary_phone` are stored as
  // ciphertext, so a plaintext equality filter on the base column both hits the
  // §16 "no querying an encrypted column by value" footgun and never matches.
  // Skip the fast lookup in that case (it would only ever return nothing) — the
  // authoritative CRM link is created by the customers `link-channel-message`
  // subscriber, which does an in-memory decrypted comparison. A blind-index
  // column is the proper fast-path fix here (same follow-up as
  // `customers/lib/findPeopleByAddresses`).
  if (isTenantDataEncryptionEnabled()) return undefined

  let queryEngine: QueryEngineLike | null = null
  try {
    queryEngine = params.container.resolve<QueryEngineLike>('queryEngine')
  } catch {
    return undefined
  }
  if (!queryEngine || typeof queryEngine.query !== 'function') return undefined

  const filter = buildPersonLookupFilter(params.email, params.phone)
  if (!filter) return undefined

  try {
    const rows = await queryEngine.query('customers:customer_entity', {
      tenantId: params.scope.tenantId,
      organizationId: params.scope.organizationId,
      filter,
      limit: 1,
    })
    const first = rows?.[0]
    const id = first && typeof first.id === 'string' ? (first.id as string) : undefined
    return id
  } catch {
    return undefined
  }
}

function buildPersonLookupFilter(email?: string, phone?: string): Record<string, unknown> | null {
  if (email) return { primary_email: email, kind: 'person' }
  if (phone) return { primary_phone: phone, kind: 'person' }
  return null
}

function heuristicEmail(senderIdentifier: string): string | undefined {
  if (!senderIdentifier.includes('@')) return undefined
  // Don't second-guess provider-supplied data; just check it's email-shaped.
  return senderIdentifier.includes('.') ? senderIdentifier : undefined
}

function heuristicPhone(senderIdentifier: string): string | undefined {
  // Plain heuristic: +CC followed by 6+ digits. Real phone validation is the
  // adapter's job (the email integration spec elaborates IMAP paths).
  if (/^\+\d{6,}$/.test(senderIdentifier)) return senderIdentifier
  return undefined
}
