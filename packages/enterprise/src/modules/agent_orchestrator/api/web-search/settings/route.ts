import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  describeOptionsSchema,
  instantiateAdapter,
  maskSecrets,
  resolveAdapterModules,
  unmaskSecrets,
  searchPolicySchema,
  type AdapterRegistryEntry,
} from '@open-mercato/web-research'
import {
  WEB_SEARCH_CONFIG_MODULE,
  WEB_SEARCH_CONFIG_NAME,
  resolveWebSearchSettings,
  storedSettingsSchema,
} from '../../../lib/webSearch/policy'
import { invalidateWebSearchHealthCache } from '../../../lib/webSearch/healthCache'
import { adapterSecretFields, canEncryptSecrets, encryptAdapterSecrets } from '../../../lib/webSearch/secretStorage'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { hostCapabilitiesFor } from '../../../lib/webSearch/registry'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Read/write the tenant's web-search policy.
 *
 * GET also returns the installed adapter catalogue so the admin form can list
 * adapters that exist but are not yet in the policy — otherwise installing a new
 * adapter package would leave it invisible until someone hand-wrote its entry.
 */
/**
 * Reading the policy uses the same view-level gate as the rest of the module, so
 * the settings page is reachable wherever the other agent pages are. Writing it
 * stays on `agents.manage` — this configures outbound egress and stores adapter
 * credentials.
 */
const logger = createLogger('agent_orchestrator').child({ component: 'web-search-settings' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
  PUT: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.manage'] },
}

type ModuleConfigServiceLike = {
  setValue(
    moduleId: string,
    name: string,
    value: unknown,
    scope?: { tenantId?: string | null },
  ): Promise<unknown>
  getRecord?(
    moduleId: string,
    name: string,
    scope?: { tenantId?: string | null },
  ): Promise<{ value: unknown } | null>
}

/**
 * The tenant's own stored row, not the env-overlaid view.
 *
 * A partial update must preserve what the tenant actually saved; merging over the
 * resolved settings would silently promote every deployment default into the
 * tenant row the first time anyone touched one field.
 */
async function readStoredValue(
  service: ModuleConfigServiceLike,
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  if (!service.getRecord) return null
  try {
    const record = await service.getRecord(WEB_SEARCH_CONFIG_MODULE, WEB_SEARCH_CONFIG_NAME, { tenantId })
    const value = record?.value
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function loadRegistry(container: AwilixContainer) {
  try {
    return resolveAdapterModules((container.resolve('webResearchAdapterEntries') as AdapterRegistryEntry[]) ?? [])
  } catch {
    return resolveAdapterModules([])
  }
}

/**
 * Describes every installed adapter: its configurable fields (derived from the
 * adapter's own schema, so a third-party package needs no UI of its own) and
 * whether the stored options actually satisfy it. `configured: false` is what an
 * operator sees after installing an adapter that still needs a key — the same
 * check the engine uses at request time, so the two can never disagree.
 */
function catalogue(container: AwilixContainer, adapterOptions: Readonly<Record<string, unknown>>) {
  const registry = loadRegistry(container)
  return {
    installed: registry.loaded.map((entry) => {
      const fields = describeOptionsSchema(entry.module)
      const stored = (adapterOptions[entry.module.id] as Record<string, unknown> | undefined) ?? {}
      // Must mirror what the engine injects, or an adapter whose requirement is a
      // host capability rather than stored config (model-native needs a model
      // resolver) reports "not configured" here while working fine at runtime.
      const built = instantiateAdapter(entry, {
        ...stored,
        ...hostCapabilitiesFor(entry.module.id, container),
      })
      const readiness = built.adapter.readiness()
      return {
        id: entry.module.id,
        kind: entry.module.kind,
        packageName: entry.packageName,
        fields,
        options: maskSecrets(stored, fields),
        configured: readiness.ready,
        configurationHint: readiness.ready ? null : readiness.reason,
      }
    }),
    rejected: registry.rejected.map((entry) => ({ ...entry })),
  }
}

/**
 * Drops the guardrails a tenant row must never hold. Today that is
 * `allowPrivateHosts` — see `guardrailsSchema` in `lib/webSearch/policy.ts` for
 * why it is an instance decision.
 */
function stripInstanceOnlyGuardrails(guardrails: Record<string, unknown>): Record<string, unknown> {
  const { allowPrivateHosts: _instanceOnly, ...writable } = guardrails
  return writable
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const settings = await resolveWebSearchSettings(container, auth.tenantId ?? null)
  const { installed, rejected } = catalogue(container, settings.adapterOptions)

  return NextResponse.json({
    policy: settings.policy,
    guardrails: settings.guardrails,
    source: settings.source,
    installed,
    rejected,
    // Answered before the operator pastes a key, not after it is on disk.
    secretsEncrypted: await canEncryptSecrets(container, auth.tenantId ?? null),
  })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId) {
    return NextResponse.json({ error: 'A tenant scope is required to save web-search settings' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = storedSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid settings', details: parsed.error.issues }, { status: 400 })
  }

  const container = await createRequestContainer()
  let service: ModuleConfigServiceLike
  try {
    service = container.resolve('moduleConfigService') as ModuleConfigServiceLike
  } catch {
    return NextResponse.json({ error: 'Module configuration store is unavailable' }, { status: 503 })
  }

  // Secrets are never sent to the browser, so the client echoes a placeholder
  // back for any it did not change. Restore those from what is already stored,
  // or a save from the settings form would wipe every key it was not shown.
  const current = await resolveWebSearchSettings(container, auth.tenantId)
  const registry = loadRegistry(container)
  const incomingOptions = (parsed.data.adapterOptions ?? {}) as Record<string, Record<string, unknown>>
  // Merged per adapter, not replaced, so saving one adapter's card cannot drop
  // the credentials of every other adapter the form did not submit.
  const adapterOptions: Record<string, unknown> = { ...current.adapterOptions, ...incomingOptions }
  for (const entry of registry.loaded) {
    const incoming = incomingOptions[entry.module.id]
    if (!incoming) continue
    const stored = (current.adapterOptions[entry.module.id] as Record<string, unknown> | undefined) ?? {}
    adapterOptions[entry.module.id] = unmaskSecrets(incoming, stored, describeOptionsSchema(entry.module))
  }

  /**
   * A partial update: every key the body omits keeps its stored value.
   *
   * The write replaces the whole stored document, so without this a body that
   * left out `guardrails` erased them — and the form used to autosave without
   * sending them, which dropped an operator's deny list the first time anyone
   * opened the screen. It is also what lets each section of the form own its own
   * Save button: a section submits its own fields and nothing else moves.
   */
  const { guardrails: incomingGuardrails, adapterOptions: _ignored, ...incomingPolicy } = parsed.data
  const storedPolicy = searchPolicySchema.safeParse(
    (await readStoredValue(service, auth.tenantId)) ?? {},
  )

  // Encrypted at the last moment, so everything above works in plaintext and
  // only the row is ciphertext. `encrypted: false` means no DEK was available —
  // it is reported to the operator rather than swallowed, because an API key
  // they believe is protected and is not is worse than one they know is bare.
  const { adapterOptions: storedAdapterOptions, encrypted } = await encryptAdapterSecrets(
    container,
    auth.tenantId,
    adapterOptions,
    adapterSecretFields(container),
  )
  if (!encrypted) {
    logger.warn(
      'Tenant data encryption is unavailable; web-search adapter credentials are stored in plaintext',
      { tenantId: auth.tenantId },
    )
  }

  await service.setValue(
    WEB_SEARCH_CONFIG_MODULE,
    WEB_SEARCH_CONFIG_NAME,
    {
      ...(storedPolicy.success ? storedPolicy.data : {}),
      ...incomingPolicy,
      // `current.guardrails` carries the env-resolved `allowPrivateHosts`;
      // persisting it would write an instance value into a tenant row that
      // nothing reads, which reads as authoritative and is not.
      guardrails: stripInstanceOnlyGuardrails({ ...current.guardrails, ...(incomingGuardrails ?? {}) }),
      adapterOptions: storedAdapterOptions,
    },
    { tenantId: auth.tenantId },
  )

  // A saved key, base URL or enabled flag can change what a probe would answer,
  // so the cached health rows this tenant is serving stop being true the moment
  // the write lands. Dropping them is cheaper than showing a stale green.
  await invalidateWebSearchHealthCache(container, auth.tenantId)

  const settings = await resolveWebSearchSettings(container, auth.tenantId)
  const { installed } = catalogue(container, settings.adapterOptions)
  return NextResponse.json({
    policy: settings.policy,
    guardrails: settings.guardrails,
    source: settings.source,
    installed,
    secretsEncrypted: encrypted,
  })
}

const settingsResponseSchema = z.object({
  policy: z.object({}).passthrough(),
  guardrails: z.object({}).passthrough(),
  source: z.enum(['tenant', 'instance']),
  installed: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string(),
        packageName: z.string(),
        fields: z.array(z.object({ name: z.string(), kind: z.string(), required: z.boolean(), secret: z.boolean() })),
        options: z.record(z.string(), z.unknown()),
        configured: z.boolean(),
        configurationHint: z.string().nullable(),
      }),
    )
    .optional(),
  rejected: z
    .array(z.object({ id: z.string().nullable(), packageName: z.string(), reason: z.string() }))
    .optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Agent web-search settings',
  methods: {
    GET: {
      summary: 'Read the resolved web-search policy and installed adapter catalogue',
      description:
        'Returns the tenant-resolved policy (env default overlaid with the tenant row), the guardrails, and every installed adapter package. Gated by agent_orchestrator.agents.view.',
      responses: [{ status: 200, description: 'Resolved settings', schema: settingsResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Missing agent_orchestrator.agents.view', schema: z.object({ error: z.string() }) },
      ],
    },
    PUT: {
      summary: 'Save the tenant web-search policy',
      description:
        'Writes the tenant-scoped policy row. Validated against the engine policy schema; unknown adapters are accepted so a policy can be written before its package is installed.',
      responses: [{ status: 200, description: 'Saved settings', schema: settingsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid settings or missing tenant', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Missing agent_orchestrator.agents.manage', schema: z.object({ error: z.string() }) },
        { status: 503, description: 'Config store unavailable', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
