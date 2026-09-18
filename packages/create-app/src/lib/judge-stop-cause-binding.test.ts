import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error The standalone evaluator is plain ESM by design.
import { normalizeManifestStopCause, terminationReportErrors } from '../../agentic/shared/scripts/evaluate-agent-harness.mjs'

test('judge termination normalization binds the report to manifest stopCause evidence', () => {
  assert.equal(normalizeManifestStopCause({ stopCause: { classification: 'provider-limit' } }), 'provider-limit')
  assert.equal(normalizeManifestStopCause({ stopCause: { classification: 'not-a-classification' } }), 'unknown')
  assert.equal(normalizeManifestStopCause({}), 'unknown')
  assert.deepEqual(
    terminationReportErrors('- Termination: provider-limit — usage limit reached.', 'provider-limit'),
    [],
  )
  assert.match(
    terminationReportErrors('- Termination: completed — claimed success.', 'provider-limit')[0],
    /does not match normalized manifest stop cause provider-limit/,
  )
})
