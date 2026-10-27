import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
  rateLimitErrorSchema,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import { resolveRateLimiter } from '../../../lib/guardrails/publicEndpointRateLimit'
import { resolveOtelExportDeployment } from '../../../lib/trace/otel/exportSettings'
import { recordOtelExportHealth } from '../../../lib/trace/otel/exportHealth'
import { OTEL_SPAN_ID_BYTES, OTEL_TRACE_ID_BYTES, nonZeroHex } from '../../../lib/trace/otel/ids'
import { OTEL_EXPORT_SCOPE_NAME } from '../../../lib/trace/otel/mapAgentRunToOtlp'
import { encodeOtlpTraceRequest, type OtlpResourceSpansInput } from '../../../lib/trace/otel/otlpJson'
import { postOtlpTraces } from '../../../lib/trace/otel/otlpHttpClient'
import { OM_OTEL_RESOURCE_ATTRIBUTES, OTEL_STANDARD_ATTRIBUTES } from '../../../lib/trace/otel/otelAttributes'
import { OTEL_EXPORT_WRITE_FEATURES, hasOtelExportFeatures } from '../../../commands/otelExport'
import { agentOrchestratorTag } from '../../openapi'

/**
 * Sends one synthetic `om.export.test` span to the deployment's OTLP endpoint
 * for the caller's tenant and records the outcome as the tenant's export
 * health. A backend rejection is a successful call (`ok: false`); only a
 * disabled deployment (409) or the per-tenant ceiling (429) fail the request.
 */

const OTEL_EXPORT_TEST_SPAN_NAME = 'om.export.test'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [...OTEL_EXPORT_WRITE_FEATURES] },
}

const otelExportTestRateLimitConfig = readEndpointRateLimitConfig('AGENT_ORCH_OTEL_EXPORT_TEST', {
  points: 1,
  duration: 10,
  keyPrefix: 'agent_orchestrator:otel_export_test',
})

function buildTestSpan(input: {
  tenantId: string
  organizationId: string | null
  serviceName: string
  nowMs: number
}): OtlpResourceSpansInput {
  return {
    resource: {
      attributes: {
        [OTEL_STANDARD_ATTRIBUTES.serviceName]: input.serviceName,
        [OM_OTEL_RESOURCE_ATTRIBUTES.tenantId]: input.tenantId,
        [OM_OTEL_RESOURCE_ATTRIBUTES.organizationId]: input.organizationId,
      },
    },
    scopeSpans: [
      {
        scope: { name: OTEL_EXPORT_SCOPE_NAME, version: APP_VERSION },
        spans: [
          {
            traceId: nonZeroHex(randomBytes(OTEL_TRACE_ID_BYTES)),
            spanId: nonZeroHex(randomBytes(OTEL_SPAN_ID_BYTES)),
            name: OTEL_EXPORT_TEST_SPAN_NAME,
            kind: 'internal',
            startTime: input.nowMs,
            endTime: input.nowMs,
            status: { code: 'ok' },
          },
        ],
      },
    ],
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId) {
    return NextResponse.json({ error: 'A tenant scope is required to send a test span' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  if (!(await hasOtelExportFeatures(container, auth, scope, OTEL_EXPORT_WRITE_FEATURES))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const deployment = resolveOtelExportDeployment()
  if (!deployment.enabled || !deployment.endpoint) {
    return NextResponse.json({ error: 'otel_export_disabled' }, { status: 409 })
  }

  const limiter = resolveRateLimiter(container)
  if (limiter === 'broken') {
    return NextResponse.json({ error: RATE_LIMIT_UNAVAILABLE_FALLBACK }, { status: 503 })
  }
  if (limiter !== 'absent') {
    const rateLimited = await checkRateLimit(
      limiter,
      otelExportTestRateLimitConfig,
      `tenant:${auth.tenantId}`,
      RATE_LIMIT_ERROR_FALLBACK,
      { failClosed: true, unavailableMessage: RATE_LIMIT_UNAVAILABLE_FALLBACK },
    )
    if (rateLimited) return rateLimited
  }

  const request = encodeOtlpTraceRequest(
    buildTestSpan({
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
      serviceName: deployment.serviceName,
      nowMs: Date.now(),
    }),
  )
  const result = await postOtlpTraces({
    endpoint: deployment.endpoint,
    headers: deployment.headers,
    body: JSON.stringify(request),
  })
  const ok = result.outcome === 'ok'
  const errorCode = ok ? null : result.errorCode ?? (result.httpStatus ? `http_${result.httpStatus}` : 'unknown')
  await recordOtelExportHealth(
    container,
    auth.tenantId,
    ok ? { outcome: 'success' } : { outcome: 'error', errorCode: errorCode ?? 'unknown' },
  )
  return NextResponse.json({ ok, httpStatus: result.httpStatus, latencyMs: result.latencyMs, errorCode })
}

const errorSchema = z.object({ error: z.string() })

const testResponseSchema = z.object({
  ok: z.boolean(),
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number(),
  errorCode: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Agent OTel export test span',
  methods: {
    POST: {
      summary: 'Send a test span to the OTLP endpoint',
      description:
        'Sends one synthetic om.export.test span for the caller’s tenant to the deployment OTLP endpoint and records the outcome as the tenant’s export health. Returns 200 with ok false when the backend rejects the span. Limited to one call per 10 seconds per tenant. Requires agent_orchestrator.agents.manage.',
      responses: [{ status: 200, description: 'Export attempt outcome', schema: testResponseSchema }],
      errors: [
        { status: 400, description: 'Missing tenant', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.agents.manage', schema: errorSchema },
        { status: 409, description: 'OTel export is disabled for this deployment', schema: errorSchema },
        { status: 429, description: 'Too many test spans', schema: rateLimitErrorSchema },
        { status: 503, description: 'Rate limiter unavailable', schema: errorSchema },
      ],
    },
  },
}
