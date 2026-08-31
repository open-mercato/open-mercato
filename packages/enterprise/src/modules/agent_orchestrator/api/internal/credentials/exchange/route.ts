import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { findSessionApiKeyWithSecret } from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { AgentRun } from '../../../../data/entities'
import { enforcePublicEndpointRateLimit } from '../../../../lib/guardrails/publicEndpointRateLimit'
import { verifyBusinessHarnessRunGrant } from '../../../../lib/runtime/businessHarnessGrant'
import { agentOrchestratorTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: false },
}

const exchangeSchema = z
  .object({
    protocolVersion: z.literal('1'),
    runId: z.string().uuid(),
    purpose: z.enum(['model', 'capability']),
    audience: z.string().min(1).max(256),
    bindingId: z.string().min(1).max(128),
    minimumTtlMs: z.number().int().positive().max(300_000),
  })
  .strict()

const brokerRateLimitConfig = readEndpointRateLimitConfig('AGENT_ORCH_HARNESS_CREDENTIALS', {
  points: 240,
  duration: 60,
  keyPrefix: 'agent_orchestrator:harness_credentials',
})

export async function POST(req: Request) {
  const container = await createRequestContainer()
  const rateLimited = await enforcePublicEndpointRateLimit(container, req, brokerRateLimitConfig)
  if (rateLimited) return rateLimited

  const token = readBearerToken(req.headers.get('authorization'))
  const grant = token ? verifyBusinessHarnessRunGrant(token) : null
  if (!grant) return errorResponse(401, 'Credential exchange authorization failed')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'Invalid credential exchange request')
  }
  const parsed = exchangeSchema.safeParse(body)
  if (!parsed.success) return errorResponse(422, 'Invalid credential exchange request')

  const request = parsed.data
  const capability = request.purpose === 'model' ? grant.model : grant.capability
  if (
    request.runId !== grant.runId ||
    request.audience !== capability.audience ||
    request.bindingId !== capability.bindingId ||
    grant.exp * 1000 - Date.now() < request.minimumTtlMs
  ) {
    return errorResponse(403, 'Credential exchange authorization failed')
  }

  const em = container.resolve<EntityManager>('em').fork()
  const run = await em.findOne(AgentRun, {
    id: grant.runId,
    tenantId: grant.tenantId,
    organizationId: grant.organizationId,
    agentId: grant.agentId,
    runtime: 'business-harness',
    status: 'running',
    deletedAt: null,
  })
  if (!run) return errorResponse(403, 'Credential exchange authorization failed')

  if (request.purpose === 'model') {
    const provider = llmProviderRegistry.get(grant.model.providerId)
    const value = provider?.resolveApiKey(process.env)
    if (!provider || !value) return errorResponse(503, 'Requested credential is unavailable')
    return leaseResponse({
      leaseId: `run:${grant.runId}:model:${grant.model.providerId}`,
      type: 'api-key',
      value,
      expiresAt: new Date(grant.exp * 1000),
      metadata: {},
    })
  }

  const recovered = await findSessionApiKeyWithSecret(em, grant.capability.sessionToken)
  const key = recovered?.key
  if (
    !recovered ||
    !key ||
    key.tenantId !== grant.tenantId ||
    key.organizationId !== grant.organizationId ||
    key.sessionUserId !== grant.userId ||
    key.sessionToken !== grant.capability.sessionToken
  ) {
    return errorResponse(403, 'Credential exchange authorization failed')
  }
  const expiresAt = earliestDate(new Date(grant.exp * 1000), key.expiresAt ?? null)
  if (expiresAt.getTime() - Date.now() < request.minimumTtlMs) {
    return errorResponse(403, 'Credential exchange authorization failed')
  }
  return leaseResponse({
    leaseId: `run:${grant.runId}:capability:${key.id}`,
    type: 'api-key',
    value: recovered.secret,
    expiresAt,
    metadata: { sessionToken: grant.capability.sessionToken },
  })
}

function readBearerToken(value: string | null): string | null {
  if (!value?.startsWith('Bearer ')) return null
  const token = value.slice('Bearer '.length).trim()
  return token || null
}

function earliestDate(first: Date, second: Date | null): Date {
  return second && second.getTime() < first.getTime() ? second : first
}

function leaseResponse(input: {
  leaseId: string
  type: 'api-key' | 'bearer' | 'opaque'
  value: string
  expiresAt: Date
  metadata: Record<string, string>
}) {
  return NextResponse.json(
    {
      leaseId: input.leaseId,
      type: input.type,
      value: input.value,
      expiresAt: input.expiresAt.toISOString(),
      metadata: input.metadata,
    },
    {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}

function errorResponse(status: number, message: string) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}

export const openApi = {
  tags: [agentOrchestratorTag],
  summary: 'Exchange a business harness run grant for a short-lived credential lease',
  methods: {
    POST: {
      summary: 'Exchange a run-bound grant for a model or capability credential',
      tags: [agentOrchestratorTag],
      responses: [
        { status: 200, description: 'Short-lived credential lease' },
        { status: 401, description: 'Run grant is missing or invalid' },
        { status: 403, description: 'Grant does not authorize this exchange' },
        { status: 422, description: 'Invalid exchange request' },
        { status: 429, description: 'Too many exchange requests' },
        { status: 503, description: 'Rate limiter or requested credential is unavailable' },
      ],
    },
  },
}
