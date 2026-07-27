import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { listAgentEntries, ensureAgentsLoaded } from '../../lib/sdk/defineAgent'
import { getAgentIconMap } from '../../lib/settings/agentSettings'
import { AGENT_ICON_NAMES } from '../../data/agentIcons'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
}

const agentItemSchema = z.object({
  id: z.string(),
  resultKind: z.enum(['informative', 'actionable']),
  runtime: z.enum(['in-process', 'native', 'opencode', 'external']),
  tools: z.array(z.string()),
  skills: z.array(z.string()),
  label: z.string(),
  description: z.string(),
  // Per-tenant presentation icon (lucide name) overriding the initials avatar
  // in the agents list / overview. Null when the tenant has not set one.
  icon: z.enum(AGENT_ICON_NAMES).nullable(),
  // Optional per-agent example input for the Playground "Insert sample" button.
  sampleInput: z.unknown().optional(),
  // Optional declared Caseload facts (label + dot-path into run input/proposal payload/run output).
  facts: z
    .array(
      z.object({
        label: z.string(),
        source: z.enum(['input', 'payload', 'output']),
        path: z.string(),
        format: z.enum(['text', 'number', 'boolean', 'percent']).optional(),
      }),
    )
    .optional(),
})

const agentListResponseSchema = z.object({
  items: z.array(agentItemSchema),
})

const errorSchema = z.object({ error: z.string() })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureAgentsLoaded()

  // Per-tenant presentation icons. Best-effort: a missing scope or a settings
  // read failure must not break the registry listing — agents still render with
  // their initials fallback.
  let iconByAgent = new Map<string, string>()
  if (auth.tenantId && auth.orgId) {
    try {
      const container = await createRequestContainer()
      const em = (container.resolve('em') as EntityManager).fork()
      iconByAgent = await getAgentIconMap(em, { tenantId: auth.tenantId, organizationId: auth.orgId })
    } catch {
      iconByAgent = new Map()
    }
  }

  const items = listAgentEntries().map((entry) => ({
    id: entry.id,
    resultKind: entry.resultKind,
    runtime: entry.runtime,
    tools: entry.tools,
    skills: entry.skills,
    label: entry.label,
    description: entry.description,
    icon: iconByAgent.get(entry.id) ?? null,
    sampleInput: entry.sampleInput,
    facts: entry.facts,
  }))
  return NextResponse.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'List agents',
  methods: {
    GET: {
      summary: 'List registered agents',
      description:
        'Returns the in-module agent registry (id, result kind, tools, skills, label, description) for agents declared via defineAgent.',
      responses: [
        { status: 200, description: 'Registered agents', schema: agentListResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.agents.view', schema: errorSchema },
      ],
    },
  },
}
