import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import {
  clearWorkflowSafeCommandsForTests,
  registerWorkflowSafeCommands,
} from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import { executeProposal } from '../lib/runtime/executeProposal'
import { isEffectWithinVocabulary, loadActionVocabulary } from '../lib/runtime/actionVocabulary'

/**
 * The server-side vocabulary re-check (spec `2026-08-11-agent-taxonomy.md`, Phase 2
 * step 7).
 *
 * The catalogue — workflow-safe commands ∪ registered activity types — is the OUTER
 * LIMIT on what a proposed action may effect, and it is checked AGAIN immediately
 * before the effect rather than only at agent registration: an agent registered
 * before a tenant revoked a safe command must not have a stale proposal execute.
 * Fail-closed, because a silently-dropped permission check reads as a granted one.
 */

const SAFE_COMMAND = 'customers.deals.update'

function makeCtx(execute: jest.Mock<(...args: unknown[]) => Promise<unknown>>) {
  return {
    commandBus: { execute } as never,
    commandCtx: {} as never,
    actionCommandMap: { set_stage: SAFE_COMMAND },
  }
}

describe('the effective vocabulary', () => {
  beforeEach(() => {
    clearWorkflowSafeCommandsForTests()
  })

  test('a registered safe command is inside it', async () => {
    registerWorkflowSafeCommands([{ commandId: SAFE_COMMAND, requiredFeatures: ['customers.deals.edit'] }])
    const vocabulary = await loadActionVocabulary()
    expect(vocabulary.available).toBe(true)
    expect(isEffectWithinVocabulary(vocabulary, 'set_stage', SAFE_COMMAND)).toBe(true)
  })

  test('an unregistered command is outside it', async () => {
    const vocabulary = await loadActionVocabulary()
    expect(isEffectWithinVocabulary(vocabulary, 'set_stage', SAFE_COMMAND)).toBe(false)
  })

  test('an unreadable catalogue blocks everything rather than waving it through', () => {
    const unavailable = { commandIds: new Set<string>(), activityTypeIds: new Set<string>(), available: false }
    expect(isEffectWithinVocabulary(unavailable, 'SEND_EMAIL', SAFE_COMMAND)).toBe(false)
  })
})

describe('executeProposal re-checks before the effect', () => {
  beforeEach(() => {
    clearWorkflowSafeCommandsForTests()
  })

  test('runs an action whose command is still in the catalogue', async () => {
    registerWorkflowSafeCommands([{ commandId: SAFE_COMMAND, requiredFeatures: ['customers.deals.edit'] }])
    const execute = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ result: { ok: true } })

    const results = await executeProposal([{ type: 'set_stage', payload: { stage: 'won' } }], makeCtx(execute))

    expect(results).toEqual([{ type: 'set_stage', status: 'ok', result: { ok: true } }])
    expect(execute).toHaveBeenCalledWith(SAFE_COMMAND, expect.anything())
  })

  test('a command REVOKED after the proposal was made blocks the effect', async () => {
    // The proposal was authored while the command was in the catalogue; the tenant
    // has since narrowed it, so nothing is registered when the effect would run.
    const execute = jest.fn<(...args: unknown[]) => Promise<unknown>>()

    const results = await executeProposal([{ type: 'set_stage', payload: { stage: 'won' } }], makeCtx(execute))

    expect(execute).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('skipped')
    expect(results[0]).toMatchObject({
      reason: expect.stringContaining('outside the effective action vocabulary'),
    })
  })

  test('an unmapped action type is still reported as unmapped, not as out-of-vocabulary', async () => {
    registerWorkflowSafeCommands([{ commandId: SAFE_COMMAND, requiredFeatures: ['customers.deals.edit'] }])
    const execute = jest.fn<(...args: unknown[]) => Promise<unknown>>()

    const results = await executeProposal([{ type: 'unmapped', payload: {} }], makeCtx(execute))

    expect(results[0]).toMatchObject({ status: 'skipped', reason: expect.stringContaining('no command mapped') })
  })
})
