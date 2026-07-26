import { NextResponse } from 'next/server'
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
  type AdapterRegistryEntry,
} from '@open-mercato/web-research'
import {
  WEB_SEARCH_CONFIG_MODULE,
  WEB_SEARCH_CONFIG_NAME,
  resolveWebSearchSettings,
  storedSettingsSchema,
} from '../../../lib/webSearch/policy'
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
}

function loadRegistry(container: { resolve(key: string): unknown }) {
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
function catalogue(
  container: { resolve(key: string): unknown },
  adapterOptions: Readonly<Record<string, unknown>>,
) {
  const registry = loadRegistry(container)
  return {
    installed: registry.loaded.map((entry) => {
      const fields = describeOptionsSchema(entry.module)
      const stored = (adapterOptions[entry.module.id] as Record<string, unknown> | undefined) ?? {}
      const built = instantiateAdapter(entry, stored)
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
  const adapterOptions: Record<string, unknown> = { ...incomingOptions }
  for (const entry of registry.loaded) {
    const incoming = incomingOptions[entry.module.id]
    if (!incoming) continue
    const stored = (current.adapterOptions[entry.module.id] as Record<string, unknown> | undefined) ?? {}
    adapterOptions[entry.module.id] = unmaskSecrets(incoming, stored, describeOptionsSchema(entry.module))
  }

  await service.setValue(
    WEB_SEARCH_CONFIG_MODULE,
    WEB_SEARCH_CONFIG_NAME,
    { ...parsed.data, adapterOptions },
    { tenantId: auth.tenantId },
  )

  const settings = await resolveWebSearchSettings(container, auth.tenantId)
  const { installed } = catalogue(container, settings.adapterOptions)
  return NextResponse.json({
    policy: settings.policy,
    guardrails: settings.guardrails,
    source: settings.source,
    installed,
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
