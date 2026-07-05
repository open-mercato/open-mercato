import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { listAgentEntries, ensureAgentsLoaded } from '../../lib/sdk/defineAgent'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
}

const agentItemSchema = z.object({
  id: z.string(),
  resultKind: z.enum(['informative', 'actionable']),
  runtime: z.enum(['in-process', 'opencode', 'external']),
  tools: z.array(z.string()),
  skills: z.array(z.string()),
  label: z.string(),
  description: z.string(),
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
  const items = listAgentEntries().map((entry) => ({
    id: entry.id,
    resultKind: entry.resultKind,
    runtime: entry.runtime,
    tools: entry.tools,
    skills: entry.skills,
    label: entry.label,
    description: entry.description,
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
