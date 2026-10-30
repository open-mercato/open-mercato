import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  aiAgentConversationRunsParamsSchema,
  aiAgentRunListQuerySchema,
} from '../../../../../data/validators'
import {
  AI_AGENT_RUNS_VIEW_FEATURE,
  agentRunAuthError,
  agentRunJsonError,
  canReadConversationRuns,
  listAgentRunPage,
  resolveAgentRunCaller,
} from '../../../../../lib/agent-run-access'

const logger = createLogger('ai_assistant')

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'AI agent runs of a conversation',
  methods: {
    GET: {
      operationId: 'aiAssistantListConversationAgentRuns',
      summary: 'List the agent runs recorded for one chat conversation.',
      description:
        'Returns the run list shape ordered by `startedAt` ascending. The caller needs ' +
        '`ai_assistant.runs.view` and read access to the conversation (owner, active ' +
        'participant, or organization-visible conversation in the caller\'s tenant and ' +
        'organization); `ai_assistant.runs.view_all` grants access to every conversation in ' +
        'scope. Rows carry metadata only. `page` / `pageSize` (default 25, max 100) paginate.',
      responses: [
        {
          status: 200,
          description: '`{ items, total, page, pageSize, totalPages }`.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid conversation id or query parameters.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks the `ai_assistant.runs.view` feature.' },
        { status: 404, description: 'No conversation accessible to the caller.' },
        { status: 500, description: 'Internal runtime failure.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [AI_AGENT_RUNS_VIEW_FEATURE] },
}

interface RouteContext {
  params: Promise<{ conversationId: string }>
}

function notFound(): NextResponse {
  return agentRunJsonError(404, 'Conversation not found.', 'conversation_not_found')
}

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  const caller = await resolveAgentRunCaller(req)
  if (caller.kind === 'unauthorized' || caller.kind === 'forbidden') return agentRunAuthError(caller)

  const paramsResult = aiAgentConversationRunsParamsSchema.safeParse(await context.params)
  if (!paramsResult.success) {
    return agentRunJsonError(400, 'Invalid conversation id.', 'validation_error', {
      issues: paramsResult.error.issues,
    })
  }
  const url = new URL(req.url)
  const queryResult = aiAgentRunListQuerySchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!queryResult.success) {
    return agentRunJsonError(400, 'Invalid query parameters.', 'validation_error', {
      issues: queryResult.error.issues,
    })
  }
  if (caller.kind === 'missing-tenant') return notFound()

  try {
    const { ctx, container } = caller
    const em = container.resolve<EntityManager>('em')
    const conversationId = paramsResult.data.conversationId
    if (!(await canReadConversationRuns(em, ctx, conversationId))) return notFound()
    const result = await listAgentRunPage(
      em,
      { ...ctx, canViewAll: true },
      {
        filters: { conversationId },
        page: queryResult.data.page,
        pageSize: queryResult.data.pageSize,
        order: 'asc',
      },
    )
    return NextResponse.json(result)
  } catch (error) {
    logger.error('AI conversation agent runs GET — Failure', { err: error })
    return agentRunJsonError(500, 'Failed to list conversation agent runs.', 'internal_error')
  }
}
