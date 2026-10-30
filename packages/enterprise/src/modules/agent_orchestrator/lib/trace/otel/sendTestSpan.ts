import { randomBytes } from 'node:crypto'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import type { OtelExportProtocol } from './exportSettings'
import { OTEL_SPAN_ID_BYTES, OTEL_TRACE_ID_BYTES, nonZeroHex } from './ids'
import { OTEL_EXPORT_SCOPE_NAME } from './mapAgentRunToOtlp'
import { OM_OTEL_RESOURCE_ATTRIBUTES, OTEL_STANDARD_ATTRIBUTES } from './otelAttributes'
import type { OtlpResourceSpansInput } from './otlpJson'
import { postOtlpTraces } from './otlpHttpClient'
import { encodeOtlpRequestBody } from './otlpRequestBody'

export const OTEL_EXPORT_TEST_SPAN_NAME = 'om.export.test'

/** Where a synthetic test span goes. Never logged or returned to callers. */
export type OtelTestSpanDestination = {
  endpoint: string
  headers: Record<string, string>
  protocol: OtelExportProtocol
  serviceName: string
}

export type OtelTestSpanScope = {
  tenantId: string
  organizationId: string | null
}

/** Outcome of one test span; carries no endpoint, header or body data. */
export type OtelTestSpanResult = {
  ok: boolean
  httpStatus: number | null
  latencyMs: number
  errorCode: string | null
}

export function buildOtelTestSpan(input: OtelTestSpanScope & { serviceName: string; nowMs: number }): OtlpResourceSpansInput {
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

/**
 * Sends one synthetic `om.export.test` span to the destination in its wire
 * protocol. A backend rejection is reported as `ok: false` with an error code.
 */
export async function sendOtelTestSpan(
  destination: OtelTestSpanDestination,
  scope: OtelTestSpanScope,
): Promise<OtelTestSpanResult> {
  const request = encodeOtlpRequestBody(
    buildOtelTestSpan({ ...scope, serviceName: destination.serviceName, nowMs: Date.now() }),
    destination.protocol,
  )
  const result = await postOtlpTraces({
    endpoint: destination.endpoint,
    headers: destination.headers,
    body: request.body,
    contentType: request.contentType,
  })
  const ok = result.outcome === 'ok'
  const errorCode = ok ? null : result.errorCode ?? (result.httpStatus ? `http_${result.httpStatus}` : 'unknown')
  return { ok, httpStatus: result.httpStatus, latencyMs: result.latencyMs, errorCode }
}
