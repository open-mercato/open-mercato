import { describe, expect, test } from '@jest/globals'
import { evaluateRunControlPolicy, resolveActionClass, shouldThrottleCheckpoint } from '../run-orchestrator-service'

describe('run-orchestrator-service policy helpers', () => {
  test('resolveActionClass prefers explicit value', () => {
    expect(resolveActionClass('delete_customer', 'read')).toBe('read')
  })

  test('resolveActionClass detects read and irreversible actions', () => {
    expect(resolveActionClass('view_customer_profile')).toBe('read')
    expect(resolveActionClass('terminate_contract')).toBe('irreversible')
    expect(resolveActionClass('sync_customer_updates')).toBe('write')
  })

  test('propose autonomy always creates checkpoint', () => {
    const decision = evaluateRunControlPolicy({
      autonomyMode: 'propose',
      actionClass: 'read',
      riskLevel: 'low',
      requiresApproval: false,
      failClosed: false,
    })

    expect(decision.requiresCheckpoint).toBe(true)
    expect(decision.checkpointReasons).toContain('autonomy_mode_propose')
    expect(decision.telemetryDurability).toBe('fail_soft')
  })

  test('assist autonomy checkpoints write actions', () => {
    const decision = evaluateRunControlPolicy({
      autonomyMode: 'assist',
      actionClass: 'write',
      riskLevel: 'medium',
      requiresApproval: false,
      failClosed: false,
    })

    expect(decision.requiresCheckpoint).toBe(true)
    expect(decision.checkpointReasons).toContain('assist_mode_write_requires_checkpoint')
  })

  test('irreversible + high risk forces checkpoint and fail_closed telemetry', () => {
    const decision = evaluateRunControlPolicy({
      autonomyMode: 'auto',
      actionClass: 'irreversible',
      riskLevel: 'high',
      requiresApproval: false,
      failClosed: false,
    })

    expect(decision.requiresCheckpoint).toBe(true)
    expect(decision.checkpointReasons).toContain('irreversible_action_requires_checkpoint')
    expect(decision.telemetryDurability).toBe('fail_closed')
  })

  test('critical risk uses fail_closed telemetry even for non-irreversible actions', () => {
    const decision = evaluateRunControlPolicy({
      autonomyMode: 'auto',
      actionClass: 'write',
      riskLevel: 'critical',
      requiresApproval: false,
      failClosed: false,
    })

    expect(decision.telemetryDurability).toBe('fail_closed')
  })

  test('checkpoint throttling only applies to low-risk non-strict checkpoint reasons', () => {
    expect(
      shouldThrottleCheckpoint({
        actionClass: 'write',
        riskLevel: 'low',
        checkpointReasons: ['autonomy_mode_propose'],
        recentCheckpointCount: 100,
      }),
    ).toBe(true)

    expect(
      shouldThrottleCheckpoint({
        actionClass: 'write',
        riskLevel: 'low',
        checkpointReasons: ['risk_band_requires_approval'],
        recentCheckpointCount: 100,
      }),
    ).toBe(false)

    expect(
      shouldThrottleCheckpoint({
        actionClass: 'irreversible',
        riskLevel: 'low',
        checkpointReasons: ['autonomy_mode_propose'],
        recentCheckpointCount: 100,
      }),
    ).toBe(false)
  })
})
