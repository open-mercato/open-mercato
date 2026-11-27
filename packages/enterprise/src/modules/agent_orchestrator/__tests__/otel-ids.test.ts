import { createHash } from 'node:crypto'
import { describe, expect, test } from '@jest/globals'
import {
  OTEL_SPAN_ID_BYTES,
  OTEL_TRACE_ID_BYTES,
  agentSpanId,
  deriveOtelId,
  dispositionSpanId,
  nonZeroHex,
  runSpanId,
  traceIdFor,
  workflowSpanId,
} from '../lib/trace/otel/ids'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222'
const WORKFLOW_INSTANCE_ID = '33333333-3333-4333-8333-333333333333'
const RUN_ID = '44444444-4444-4444-8444-444444444444'
const SPAN_ROW_ID = '55555555-5555-4555-8555-555555555555'
const PROPOSAL_ID = '66666666-6666-4666-8666-666666666666'

function referenceId(seed: string, byteLength: number): string {
  return createHash('sha256').update(seed, 'utf8').digest().subarray(0, byteLength).toString('hex')
}

describe('OTel deterministic ids', () => {
  test('derive ids from the spec seed strings with NUL separators', () => {
    expect(traceIdFor({ tenantId: TENANT_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, rootRunId: RUN_ID })).toBe(
      referenceId(`om-agent-trace\0${TENANT_ID}\0${WORKFLOW_INSTANCE_ID}`, 16),
    )
    expect(traceIdFor({ tenantId: TENANT_ID, rootRunId: RUN_ID })).toBe(
      referenceId(`om-agent-trace\0${TENANT_ID}\0${RUN_ID}`, 16),
    )
    expect(runSpanId(RUN_ID)).toBe(referenceId(`om-agent-run\0${RUN_ID}`, 8))
    expect(agentSpanId(SPAN_ROW_ID)).toBe(referenceId(`om-agent-span\0${SPAN_ROW_ID}`, 8))
    expect(workflowSpanId(WORKFLOW_INSTANCE_ID)).toBe(referenceId(`om-agent-workflow\0${WORKFLOW_INSTANCE_ID}`, 8))
    expect(dispositionSpanId(PROPOSAL_ID)).toBe(referenceId(`om-agent-disposition\0${PROPOSAL_ID}`, 8))
  })

  test('pin golden values so a seed change is caught', () => {
    expect(traceIdFor({ tenantId: TENANT_ID, rootRunId: RUN_ID })).toBe('c8e56f56bb119fce46af9e91db564d02')
    expect(runSpanId(RUN_ID)).toBe('ac05603657ec63fa')
  })

  test('produce lowercase hex of the OTLP id widths and stay stable across calls', () => {
    const traceId = traceIdFor({ tenantId: TENANT_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, rootRunId: RUN_ID })
    expect(traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(traceId).toHaveLength(OTEL_TRACE_ID_BYTES * 2)
    expect(runSpanId(RUN_ID)).toMatch(/^[0-9a-f]{16}$/)
    expect(runSpanId(RUN_ID)).toHaveLength(OTEL_SPAN_ID_BYTES * 2)
    expect(traceIdFor({ tenantId: TENANT_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, rootRunId: RUN_ID })).toBe(traceId)
  })

  test('share one trace per workflow execution and isolate tenants', () => {
    const first = traceIdFor({ tenantId: TENANT_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, rootRunId: RUN_ID })
    const second = traceIdFor({ tenantId: TENANT_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, rootRunId: SPAN_ROW_ID })
    const otherTenant = traceIdFor({ tenantId: OTHER_TENANT_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, rootRunId: RUN_ID })
    expect(second).toBe(first)
    expect(otherTenant).not.toBe(first)
  })

  test('fall back to the root run id when the workflow instance id is empty', () => {
    expect(traceIdFor({ tenantId: TENANT_ID, workflowInstanceId: '', rootRunId: RUN_ID })).toBe(
      traceIdFor({ tenantId: TENANT_ID, workflowInstanceId: null, rootRunId: RUN_ID }),
    )
  })

  test('separate span id namespaces for the same source id', () => {
    const ids = new Set([runSpanId(RUN_ID), agentSpanId(RUN_ID), workflowSpanId(RUN_ID), dispositionSpanId(RUN_ID)])
    expect(ids.size).toBe(4)
  })

  test('replace an all-zero id by flipping the last byte', () => {
    expect(nonZeroHex(new Uint8Array(8))).toBe('0000000000000001')
    expect(nonZeroHex(new Uint8Array(16))).toBe('00000000000000000000000000000001')
    expect(nonZeroHex(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 7]))).toBe('0000000000000007')
    expect(deriveOtelId(['om-agent-run', RUN_ID], 8)).toBe(runSpanId(RUN_ID))
  })

  test('reject empty seed parts', () => {
    expect(() => runSpanId('')).toThrow('[internal]')
    expect(() => traceIdFor({ tenantId: '', rootRunId: RUN_ID })).toThrow('[internal]')
    expect(() => traceIdFor({ tenantId: TENANT_ID, rootRunId: '' })).toThrow('[internal]')
  })
})
