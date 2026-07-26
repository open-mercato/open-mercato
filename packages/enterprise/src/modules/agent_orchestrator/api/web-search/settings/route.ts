import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveAdapterModules, type AdapterRegistryEntry } from '@open-mercato/web-research'
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
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.manage'] },
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

function catalogue(container: { resolve(key: string): unknown }) {
  let entries: AdapterRegistryEntry[] = []
  try {
    entries = (container.resolve('webResearchAdapterEntries') as AdapterRegistryEntry[]) ?? []
  } catch {
    entries = []
  }
  const registry = resolveAdapterModules(entries)
  return {
    installed: registry.loaded.map((entry) => ({
      id: entry.module.id,
      kind: entry.module.kind,
      packageName: entry.packageName,
    })),
    rejected: registry.rejected.map((entry) => ({ ...entry })),
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const settings = await resolveWebSearchSettings(container, auth.tenantId ?? null)
  const { installed, rejected } = catalogue(container)

  return NextResponse.json({
    policy: settings.policy,
    guardrails: settings.guardrails,
    adapterOptions: settings.adapterOptions,
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

  await service.setValue(WEB_SEARCH_CONFIG_MODULE, WEB_SEARCH_CONFIG_NAME, parsed.data, {
    tenantId: auth.tenantId,
  })

  const settings = await resolveWebSearchSettings(container, auth.tenantId)
  return NextResponse.json({
    policy: settings.policy,
    guardrails: settings.guardrails,
    adapterOptions: settings.adapterOptions,
    source: settings.source,
  })
}

const settingsResponseSchema = z.object({
  policy: z.object({}).passthrough(),
  guardrails: z.object({}).passthrough(),
  adapterOptions: z.record(z.string(), z.unknown()),
  source: z.enum(['tenant', 'instance']),
  installed: z
    .array(z.object({ id: z.string(), kind: z.string(), packageName: z.string() }))
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
        'Returns the tenant-resolved policy (env default overlaid with the tenant row), the guardrails, and every installed adapter package. Gated by agent_orchestrator.agents.manage.',
      responses: [{ status: 200, description: 'Resolved settings', schema: settingsResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Missing agent_orchestrator.agents.manage', schema: z.object({ error: z.string() }) },
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
