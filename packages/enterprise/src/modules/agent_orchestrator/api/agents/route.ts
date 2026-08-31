import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { listAgentEntries, ensureAgentsLoaded } from '../../lib/sdk/defineAgent'
import { resolveAgentOutcomeJsonSchema } from '../../lib/sdk/agentOutcomeContract'
import { getAgentPresentationMaps } from '../../lib/settings/agentSettings'
import { AGENT_ICON_NAMES } from '../../data/agentIcons'
import { agentTypeSchema } from '../../data/validators'
import { readBusinessHarnessRuntimeMode } from '../../lib/runtime/businessHarnessMode'
import { isBusinessHarnessRuntime } from '../../lib/runtime/agentRuntimeValues'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
}

const agentItemSchema = z.object({
  id: z.string(),
  resultKind: z.enum(['researcher', 'proposal']),
  // The DECLARED type (authoring fact). Null when the agent declares none —
  // never defaulted to `researcher`, which would invent a declaration.
  agentType: agentTypeSchema.nullable(),
  // The effective action vocabulary after `catalogue ∩ allowedActions`. Null when
  // the agent declared no narrowing (it may propose anything in the catalogue);
  // an empty array means nothing survived the intersection.
  allowedActions: z.array(z.string()).nullable(),
  // `opencode` is the deprecated predecessor label of `business-harness`; it stays
  // in the published contract for the compatibility window (BACKWARD_COMPATIBILITY.md).
  runtime: z.enum(['in-process', 'native', 'business-harness', 'opencode', 'external']),
  runtimeMode: z.enum(['one-off', 'standalone']).nullable(),
  tools: z.array(z.string()),
  skills: z.array(z.string()),
  label: z.string(),
  description: z.string(),
  // Per-tenant presentation icon (lucide name) overriding the initials avatar
  // in the agents list / overview. Null when the tenant has not set one.
  icon: z.enum(AGENT_ICON_NAMES).nullable(),
  // Per-tenant operator tags, normalized. Empty when the tenant has not tagged
  // this agent; the registry list filters on them.
  tags: z.array(z.string()),
  // Optional per-agent example input for the Playground "Insert sample" button.
  sampleInput: z.unknown().optional(),
  // Optional OUTCOME JSON-Schema (the inner `data`/`proposal` shape, not the
  // envelope) so consumers can type what an agent returns without a second
  // fetch — the workflows INVOKE_AGENT editor builds its output-mapping source
  // picker from it. Absent for agents whose result schema is not the declared
  // envelope; consumers degrade to free text.
  outcomeSchema: z.record(z.string(), z.unknown()).optional(),
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

  // Per-tenant presentation overrides. Best-effort: a missing scope or a settings
  // read failure must not break the registry listing — agents still render with
  // their initials fallback and no tags.
  let iconByAgent = new Map<string, string>()
  let tagsByAgent = new Map<string, string[]>()
  if (auth.tenantId && auth.orgId) {
    try {
      const container = await createRequestContainer()
      const em = (container.resolve('em') as EntityManager).fork()
      const maps = await getAgentPresentationMaps(em, { tenantId: auth.tenantId, organizationId: auth.orgId })
      iconByAgent = maps.icons
      tagsByAgent = maps.tags
    } catch {
      iconByAgent = new Map()
      tagsByAgent = new Map()
    }
  }

  const harnessRuntimeMode = readBusinessHarnessRuntimeMode()
  const items = listAgentEntries().map((entry) => ({
    id: entry.id,
    resultKind: entry.resultKind,
    agentType: entry.agentType ?? null,
    allowedActions: entry.allowedActions ? [...entry.allowedActions] : null,
    runtime: entry.runtime,
    runtimeMode: isBusinessHarnessRuntime(entry.runtime) ? harnessRuntimeMode : null,
    tools: entry.tools,
    skills: entry.skills,
    label: entry.label,
    description: entry.description,
    icon: iconByAgent.get(entry.id) ?? null,
    tags: tagsByAgent.get(entry.id) ?? [],
    sampleInput: entry.sampleInput,
    outcomeSchema: resolveAgentOutcomeJsonSchema(entry),
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
        'Returns the in-module agent registry (id, result kind, declared agent type, narrowed action vocabulary, tools, skills, label, description, OUTCOME JSON-Schema) for agents declared via defineAgent or the file-agent conventions, merged with the tenant presentation overrides (icon, tags).',
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
