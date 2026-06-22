import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getAgentEntry, ensureAgentsLoaded } from '../../../lib/sdk/defineAgent'
import { getSkillEntry, ensureSkillsLoaded } from '../../../lib/sdk/defineSkill'
import { getAgentSkill } from '../../../lib/runtime/fileAgentSkills'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.agents.view'] },
}

const skillDetailSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  instructions: z.string(),
  tools: z.array(z.string()),
})

const agentDetailSchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  resultKind: z.enum(['informative', 'actionable']),
  runtime: z.enum(['in-process', 'opencode']),
  tools: z.array(z.string()),
  skills: z.array(z.string()),
  skillDetails: z.array(skillDetailSchema),
  subAgents: z.array(z.string()),
  label: z.string(),
  description: z.string(),
  instructions: z.string(),
  defaultProvider: z.string().nullable(),
  defaultModel: z.string().nullable(),
  loop: z.object({ maxSteps: z.number().optional() }).nullable(),
})

const errorSchema = z.object({ error: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  await Promise.all([ensureAgentsLoaded(), ensureSkillsLoaded()])
  const entry = getAgentEntry(id)
  if (!entry) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const skillDetails = entry.skills.map((skillId) => {
    const skill = getSkillEntry(skillId)
    if (skill) {
      return {
        id: skillId,
        label: skill.label,
        description: skill.description,
        instructions: skill.instructions,
        tools: skill.tools,
      }
    }
    // File-defined (OpenCode) agents carry agent-local skills (their SKILL.md
    // content) in `fileAgentSkills`, NOT the in-process `defineSkill` registry —
    // so resolve those from there, else the drawer shows the empty-default fallback.
    const fileSkill = getAgentSkill(entry.id, skillId)
    return {
      id: skillId,
      label: skillId,
      description: '',
      instructions: fileSkill?.instructions ?? '',
      tools: fileSkill?.tools ?? [],
    }
  })
  return NextResponse.json({
    id: entry.id,
    moduleId: entry.moduleId,
    resultKind: entry.resultKind,
    runtime: entry.runtime,
    tools: entry.tools,
    skills: entry.skills,
    skillDetails,
    subAgents: entry.subAgents,
    label: entry.label,
    description: entry.description,
    instructions: entry.instructions,
    defaultProvider: entry.defaultProvider ?? null,
    defaultModel: entry.defaultModel ?? null,
    loop: entry.loop ?? null,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get agent definition',
  methods: {
    GET: {
      summary: 'Get the full definition of a registered agent',
      description:
        'Returns the full in-module agent definition (id, module, result kind, tools, skills, instructions, provider/model, loop) for an agent declared via defineAgent. Gated by agent_orchestrator.agents.view.',
      responses: [
        { status: 200, description: 'Agent definition', schema: agentDetailSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.agents.view', schema: errorSchema },
        { status: 404, description: 'Unknown agent id', schema: errorSchema },
      ],
    },
  },
}
