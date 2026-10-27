import { createHash } from 'node:crypto'

export const OTEL_TRACE_ID_BYTES = 16
export const OTEL_SPAN_ID_BYTES = 8

const SEED_SEPARATOR = '\0'

export const OTEL_ID_SEED_PREFIX = {
  trace: 'om-agent-trace',
  run: 'om-agent-run',
  span: 'om-agent-span',
  workflow: 'om-agent-workflow',
  disposition: 'om-agent-disposition',
} as const

export type OtelTraceIdInput = {
  tenantId: string
  workflowInstanceId?: string | null
  rootRunId: string
}

export function nonZeroHex(bytes: Uint8Array): string {
  const copy = Uint8Array.from(bytes)
  if (copy.length > 0 && copy.every((value) => value === 0)) {
    copy[copy.length - 1] = 0x01
  }
  return Buffer.from(copy).toString('hex')
}

export function deriveOtelId(parts: readonly string[], byteLength: number): string {
  const digest = createHash('sha256').update(parts.join(SEED_SEPARATOR), 'utf8').digest()
  return nonZeroHex(digest.subarray(0, byteLength))
}

function requireSeedPart(value: string | null | undefined, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`[internal] OTel id derivation requires a non-empty ${field}`)
  }
  return value
}

export function traceIdFor(input: OtelTraceIdInput): string {
  const tenantId = requireSeedPart(input.tenantId, 'tenantId')
  const workflowInstanceId =
    typeof input.workflowInstanceId === 'string' && input.workflowInstanceId.length > 0
      ? input.workflowInstanceId
      : null
  const anchor = workflowInstanceId ?? requireSeedPart(input.rootRunId, 'rootRunId')
  return deriveOtelId([OTEL_ID_SEED_PREFIX.trace, tenantId, anchor], OTEL_TRACE_ID_BYTES)
}

export function runSpanId(runId: string): string {
  return deriveOtelId([OTEL_ID_SEED_PREFIX.run, requireSeedPart(runId, 'runId')], OTEL_SPAN_ID_BYTES)
}

export function agentSpanId(spanRowId: string): string {
  return deriveOtelId([OTEL_ID_SEED_PREFIX.span, requireSeedPart(spanRowId, 'spanRowId')], OTEL_SPAN_ID_BYTES)
}

export function workflowSpanId(workflowInstanceId: string): string {
  return deriveOtelId(
    [OTEL_ID_SEED_PREFIX.workflow, requireSeedPart(workflowInstanceId, 'workflowInstanceId')],
    OTEL_SPAN_ID_BYTES,
  )
}

export function dispositionSpanId(proposalId: string): string {
  return deriveOtelId(
    [OTEL_ID_SEED_PREFIX.disposition, requireSeedPart(proposalId, 'proposalId')],
    OTEL_SPAN_ID_BYTES,
  )
}
