import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getAgentEntry, ensureAgentsLoaded } from '../../../../lib/sdk/defineAgent'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
}

const sourceFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  tokens: z.number(),
  inContext: z.boolean(),
})

const tokenizedFileSchema = z.object({ path: z.string(), tokens: z.number() })
const tokenUsageSchema = z.object({
  total: z.number(),
  self: z.number(),
  agent: z.number(),
  outcome: z.number(),
  skills: z.array(z.object({ id: z.string(), tokens: z.number(), files: z.array(tokenizedFileSchema) })),
  tools: z.array(z.object({ name: z.string(), path: z.string(), tokens: z.number() })),
  subAgents: z.array(z.object({ id: z.string(), tokens: z.number() })),
})

const filesResponseSchema = z.object({
  agentId: z.string(),
  files: z.array(sourceFileSchema),
  tokenUsage: tokenUsageSchema.nullable(),
})

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  await ensureAgentsLoaded()
  const entry = getAgentEntry(id)
  if (!entry) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  // The Files tab is a read-only view of a file-defined (OpenCode) agent's
  // source. Native/in-process agents have no baked files → 404 so the UI never
  // renders the tab for them.
  if (entry.runtime !== 'business-harness' || !entry.sourceFiles) {
    return NextResponse.json({ error: 'Agent has no source files' }, { status: 404 })
  }
  return NextResponse.json({
    agentId: entry.id,
    files: entry.sourceFiles,
    tokenUsage: entry.tokenUsage ?? null,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get an agent definition files',
  methods: {
    GET: {
      summary: "Read a file-defined agent's raw definition files",
      description:
        "Returns the baked raw content and o200k_base token count of every construction file (AGENT.md, OUTCOME.md, skills, tools, sub-agents) of a file-defined (OpenCode) agent, for the read-only Files tab. 404 for native agents. Gated by agent_orchestrator.agents.view.",
      responses: [
        { status: 200, description: 'Agent source files', schema: filesResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.agents.view', schema: errorSchema },
        { status: 404, description: 'Unknown agent id or native agent (no files)', schema: errorSchema },
      ],
    },
  },
}
