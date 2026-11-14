import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { aiAgentRunListQuerySchema } from '../../../data/validators'
import {
  AI_AGENT_RUNS_VIEW_FEATURE,
  agentRunAuthError,
  agentRunJsonError,
  emptyAgentRunPage,
  listAgentRunPage,
  resolveAgentRunCaller,
} from '../../../lib/agent-run-access'

const logger = createLogger('ai_assistant')

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'AI agent run list',
  methods: {
    GET: {
      operationId: 'aiAssistantListAgentRuns',
      summary: 'List persisted AI agent runs visible to the caller.',
      description:
        'Returns a page of tenant/organization-scoped agent runs, newest first. Without ' +
        '`ai_assistant.runs.view_all` only the caller\'s own runs and runs of conversations ' +
        'the caller owns, participates in, or that are organization-visible are listed. Rows ' +
        'carry metadata only (no input/output text, prompts, citations or error text). ' +
        'Filters: `agentId`, `channel`, `status`, `userId`, `conversationId`, `from`, `to` ' +
        '(ISO dates on `startedAt`). `pageSize` defaults to 25 and is capped at 100.',
      responses: [
        {
          status: 200,
          description: '`{ items, total, page, pageSize, totalPages }`.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks the `ai_assistant.runs.view` feature.' },
        { status: 500, description: 'Internal runtime failure.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [AI_AGENT_RUNS_VIEW_FEATURE] },
}

export async function GET(req: NextRequest): Promise<Response> {
  const caller = await resolveAgentRunCaller(req)
  if (caller.kind === 'unauthorized' || caller.kind === 'forbidden') return agentRunAuthError(caller)

  const url = new URL(req.url)
  const queryResult = aiAgentRunListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!queryResult.success) {
    return agentRunJsonError(400, 'Invalid query parameters.', 'validation_error', {
      issues: queryResult.error.issues,
    })
  }
  const { page, pageSize, ...filters } = queryResult.data
  if (caller.kind === 'missing-tenant') return NextResponse.json(emptyAgentRunPage(page, pageSize))

  try {
    const em = caller.container.resolve<EntityManager>('em')
    const result = await listAgentRunPage(em, caller.ctx, { filters, page, pageSize, order: 'desc' })
    return NextResponse.json(result)
  } catch (error) {
    logger.error('AI agent run list GET — Failure', { err: error })
    return agentRunJsonError(500, 'Failed to list agent runs.', 'internal_error')
  }
}
