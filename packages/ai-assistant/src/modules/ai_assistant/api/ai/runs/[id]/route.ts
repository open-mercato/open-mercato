import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { aiAgentRunDetailParamsSchema } from '../../../../data/validators'
import type { AiAgentRunReader } from '../../../../lib/agent-run-reader'
import {
  AI_AGENT_RUNS_VIEW_FEATURE,
  agentRunAuthError,
  agentRunJsonError,
  canReadAgentRun,
  resolveAgentRunCaller,
  serializeAgentRunDetail,
  serializeAgentRunStep,
  serializeAgentRunToolCall,
} from '../../../../lib/agent-run-access'

const logger = createLogger('ai_assistant')

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'AI agent run detail',
  methods: {
    GET: {
      operationId: 'aiAssistantGetAgentRun',
      summary: 'Fetch one AI agent run with its steps and tool calls.',
      description:
        'Returns `{ run, steps, toolCalls, links }` with encrypted content decrypted. The run ' +
        'must belong to the caller\'s tenant and organization and be in the caller\'s scope ' +
        '(own run, or a run of a conversation the caller owns, participates in, or that is ' +
        'organization-visible; `ai_assistant.runs.view_all` lifts the conversation rule). ' +
        'Out-of-scope runs return 404 so their existence is not revealed. `run.citations` lists ' +
        'the deduplicated sources tool calls emitted during the run (null when none were emitted ' +
        'or the run was captured at the `metadata` level).',
      responses: [
        {
          status: 200,
          description:
            '`{ run, steps, toolCalls, links: { conversationId, pendingActionIds } }`.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid run id.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks the `ai_assistant.runs.view` feature.' },
        { status: 404, description: 'No run accessible to the caller.' },
        { status: 500, description: 'Internal runtime failure.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [AI_AGENT_RUNS_VIEW_FEATURE] },
}

interface RouteContext {
  params: Promise<{ id: string }>
}

function notFound(): NextResponse {
  return agentRunJsonError(404, 'Agent run not found.', 'agent_run_not_found')
}

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  const caller = await resolveAgentRunCaller(req)
  if (caller.kind === 'unauthorized' || caller.kind === 'forbidden') return agentRunAuthError(caller)

  const paramsResult = aiAgentRunDetailParamsSchema.safeParse(await context.params)
  if (!paramsResult.success) {
    return agentRunJsonError(400, 'Invalid run id.', 'validation_error', {
      issues: paramsResult.error.issues,
    })
  }
  if (caller.kind === 'missing-tenant') return notFound()

  try {
    const { ctx, container } = caller
    const reader = container.resolve<AiAgentRunReader>('aiAgentRunReader')
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const run = await reader.getRun(scope, paramsResult.data.id)
    if (!run) return notFound()
    const em = container.resolve<EntityManager>('em')
    if (!(await canReadAgentRun(em, ctx, run))) return notFound()
    const [steps, toolCalls] = await Promise.all([
      reader.listSteps(scope, run.id),
      reader.listToolCalls(scope, run.id),
    ])
    const pendingActionIds = Array.from(
      new Set(
        toolCalls
          .map((toolCall) => toolCall.pendingActionId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    )
    return NextResponse.json({
      run: serializeAgentRunDetail(run),
      steps: steps.map(serializeAgentRunStep),
      toolCalls: toolCalls.map(serializeAgentRunToolCall),
      links: { conversationId: run.conversationId ?? null, pendingActionIds },
    })
  } catch (error) {
    logger.error('AI agent run detail GET — Failure', { err: error })
    return agentRunJsonError(500, 'Failed to load agent run.', 'internal_error')
  }
}
