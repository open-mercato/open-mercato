// Unit tests for `reclassifyLine` (lib/reclassify.ts) — the shared
// "reclassify one line" helper behind both the real-time subscriber and
// `reconcileCostRing`'s repair sweep.
//
// Covered: the source set (entry types, the engine's own output, zespół 4,
// the clearing account); the MPK priority hybrid (explicit tag > active rule
// default > sentinel, an inactive or deleted rule default treated as unset);
// the marker being the source *line's* id (one reclassification per line,
// never per entry); idempotency under the per-line advisory lock (lock ->
// post inside the transaction -> commit -> emit -> tag); currency being
// copied; the contra side — mirroring the original per line, and the
// inverted direction when there is no original (credit note, 4xx -> 4xx,
// reversal whose original was never reclassified).
export {}

import { JournalEntryLineDimension } from '../../../journal_entry_line_dimension/data/entities'
import { reclassifyLine, RECLASSIFICATION_REFERENCE_TYPE } from '../reclassify'
import {
  CLEARING_ACCOUNT_ID,
  EXPLICIT_COST_CENTER_ID,
  OTHER_ACCOUNT_ID,
  RULE_DEFAULT_COST_CENTER_ID,
  SECOND_SOURCE_ACCOUNT_ID,
  SECOND_TARGET_ACCOUNT_ID,
  SENTINEL_COST_CENTER_ID,
  SOURCE_ACCOUNT_ID,
  TARGET_ACCOUNT_ID,
  TENANT,
  ORG,
  UNALLOCATED_TARGET_ACCOUNT_ID,
  buildCandidate,
  buildDeps,
  buildFakeCommandBus,
  buildFakeEm,
  seedCostCenter,
  seedEntry,
  seedNonZespol4Account,
  seedReclassification,
  seedRule,
  seedSentinelCostCenter,
  seedSettings,
  seedZespol4Account,
} from './support/fixtures'

const mockEmitLedgerEvent = jest.fn()
jest.mock('../../../ledger/events', () => ({
  emitLedgerEvent: (...args: unknown[]) => mockEmitLedgerEvent(...args),
}))

function setup() {
  const em = buildFakeEm()
  const bus = buildFakeCommandBus(em)
  mockEmitLedgerEvent.mockReset()
  mockEmitLedgerEvent.mockImplementation(async () => {
    em.log.push('emit')
  })
  return { em, bus, deps: buildDeps(em, bus) }
}

/** The configured world most tests need: source account, settings, the rule's
 * default cost centre and the sentinel. */
function setupConfigured(options: { rule?: boolean; settings?: Record<string, unknown> } = {}) {
  const world = setup()
  seedZespol4Account(world.em, SOURCE_ACCOUNT_ID)
  seedSettings(world.em, options.settings)
  seedSentinelCostCenter(world.em)
  seedCostCenter(world.em, RULE_DEFAULT_COST_CENTER_ID)
  if (options.rule !== false) seedRule(world.em)
  return world
}

describe('reclassifyLine — source set', () => {
  it('ignores a line whose entry already carries the engine marker (Invariant 3)', async () => {
    const { bus, deps } = setup()
    const result = await reclassifyLine(deps, buildCandidate({ referenceType: RECLASSIFICATION_REFERENCE_TYPE }))
    expect(result).toEqual({ reclassified: false, reason: 'already_engine_output' })
    expect(bus.execute).not.toHaveBeenCalled()
  })

  it.each(['CLOSING', 'OPENING'] as const)('ignores a line of a %s entry', async (type: 'CLOSING' | 'OPENING') => {
    const { bus, deps } = setupConfigured()
    const result = await reclassifyLine(deps, buildCandidate({ type }))
    expect(result).toEqual({ reclassified: false, reason: 'not_in_trigger_set' })
    expect(bus.execute).not.toHaveBeenCalled()
  })

  it('ignores a line on a non-zespół-4 account', async () => {
    const { em, bus, deps } = setup()
    seedNonZespol4Account(em, OTHER_ACCOUNT_ID)
    const result = await reclassifyLine(deps, buildCandidate({}, { accountId: OTHER_ACCOUNT_ID }))
    expect(result).toEqual({ reclassified: false, reason: 'not_zespol_4' })
    expect(bus.execute).not.toHaveBeenCalled()
  })

  it('ignores a line on the clearing account — also in a REVERSAL of an engine reclassification', async () => {
    const { em, bus, deps } = setupConfigured()
    seedZespol4Account(em, CLEARING_ACCOUNT_ID) // 490 resolves to code "4" like any zespół 4 account
    const result = await reclassifyLine(
      deps,
      buildCandidate({ type: 'REVERSAL', referenceType: 'journal_entry', referenceId: 'reclass-entry' }, { accountId: CLEARING_ACCOUNT_ID, debit: '100.00', credit: '0' }),
    )
    expect(result).toEqual({ reclassified: false, reason: 'clearing_account' })
    expect(bus.execute).not.toHaveBeenCalled()
  })

  it('rejects with 422 when PostingRulesSettings.clearingAccountId is not configured', async () => {
    const { em, bus, deps } = setup()
    seedZespol4Account(em, SOURCE_ACCOUNT_ID)
    seedSettings(em, { clearingAccountId: null })
    await expect(reclassifyLine(deps, buildCandidate())).rejects.toMatchObject({ status: 422 })
    expect(bus.execute).not.toHaveBeenCalled()
  })

  it('rejects with 422 when no rule matches and no unallocated-cost account is configured', async () => {
    const { bus, deps } = setupConfigured({ rule: false })
    await expect(reclassifyLine(deps, buildCandidate())).rejects.toMatchObject({ status: 422 })
    expect(bus.execute).not.toHaveBeenCalled()
  })
})

describe('reclassifyLine — MPK (cost centre) priority hybrid', () => {
  it('path 1 — an explicit journal_entry_line_dimension tag on the source line outranks the rule default', async () => {
    const { em, bus, deps } = setupConfigured()
    em.seed(JournalEntryLineDimension, {
      id: 'jeld-1',
      organizationId: ORG,
      tenantId: TENANT,
      journalEntryLineId: 'line-1',
      dimensionType: 'CostCenter',
      dimensionId: EXPLICIT_COST_CENTER_ID,
    })
    const result = await reclassifyLine(deps, buildCandidate())
    expect(result.reclassified).toBe(true)
    expect(bus.tagCalls).toEqual([expect.objectContaining({ dimensionIds: [EXPLICIT_COST_CENTER_ID] })])
  })

  it('path 2 — falls back to the rule\'s default cost centre when there is no explicit tag', async () => {
    const { bus, deps } = setupConfigured()
    await reclassifyLine(deps, buildCandidate())
    expect(bus.tagCalls).toEqual([expect.objectContaining({ dimensionIds: [RULE_DEFAULT_COST_CENTER_ID] })])
  })

  it('path 3 — falls back to the sentinel when neither an explicit tag nor a rule default exists', async () => {
    const { em, bus, deps } = setupConfigured({ rule: false })
    seedRule(em, { defaultCostCenterId: null })
    await reclassifyLine(deps, buildCandidate())
    expect(bus.tagCalls).toEqual([expect.objectContaining({ dimensionIds: [SENTINEL_COST_CENTER_ID] })])
  })

  it('treats a rule default that points at a deactivated cost centre as unset', async () => {
    const { em, bus, deps } = setupConfigured({ rule: false })
    seedCostCenter(em, 'cc-inactive', { isActive: false })
    seedRule(em, { defaultCostCenterId: 'cc-inactive' })
    await reclassifyLine(deps, buildCandidate())
    expect(bus.tagCalls).toEqual([expect.objectContaining({ dimensionIds: [SENTINEL_COST_CENTER_ID] })])
  })

  it('treats a rule default that points at a deleted cost centre as unset', async () => {
    const { em, bus, deps } = setupConfigured({ rule: false })
    seedCostCenter(em, 'cc-deleted', { deletedAt: new Date('2026-09-02') })
    seedRule(em, { defaultCostCenterId: 'cc-deleted' })
    await reclassifyLine(deps, buildCandidate())
    expect(bus.tagCalls).toEqual([expect.objectContaining({ dimensionIds: [SENTINEL_COST_CENTER_ID] })])
  })

  it('resolves the target account from PostingRulesSettings.unallocatedCostAccountId when no rule matches', async () => {
    const { bus, deps } = setupConfigured({ rule: false, settings: { unallocatedCostAccountId: UNALLOCATED_TARGET_ACCOUNT_ID } })
    const result = await reclassifyLine(deps, buildCandidate())
    expect(result.reclassified).toBe(true)
    expect(bus.postCalls[0].input.lines).toEqual([
      expect.objectContaining({ accountId: UNALLOCATED_TARGET_ACCOUNT_ID, debit: '100.00' }),
      expect.objectContaining({ accountId: CLEARING_ACCOUNT_ID, credit: '100.00' }),
    ])
    expect(bus.tagCalls).toEqual([expect.objectContaining({ dimensionIds: [SENTINEL_COST_CENTER_ID] })])
  })
})

describe('reclassifyLine — what gets posted', () => {
  it('keys the marker on the source line id and copies currency, exchange rate and amountCurrency', async () => {
    const { bus, deps } = setupConfigured()
    await reclassifyLine(
      deps,
      buildCandidate({ currencyId: 'EUR', exchangeRate: '4.3210' }, { amountCurrency: '23.14' }),
    )
    const { input } = bus.postCalls[0]
    expect(input).toMatchObject({
      referenceType: RECLASSIFICATION_REFERENCE_TYPE,
      referenceId: 'line-1',
      currencyId: 'EUR',
      exchangeRate: '4.3210',
    })
    expect(input.lines).toEqual([
      expect.objectContaining({ accountId: TARGET_ACCOUNT_ID, debit: '100.00', amountCurrency: '23.14' }),
      expect.objectContaining({ accountId: CLEARING_ACCOUNT_ID, credit: '100.00', amountCurrency: '23.14' }),
    ])
  })

  it('takes the lock, posts inside the transaction, emits only after the commit, then tags outside it', async () => {
    const { em, bus, deps } = setupConfigured()
    await reclassifyLine(deps, buildCandidate())

    expect(em.log).toEqual(['lock:line-1', 'post', 'commit', 'emit', 'tag'])
    // The posting is composed into the lock's transaction ...
    expect(bus.postCalls[0].ctx.transactionalEm).toBe(em.lastTransaction)
    // ... the tag command opens its own, so it gets none.
    expect(bus.tagCalls[0].ctx.transactionalEm).toBeUndefined()
    // The engine emits the event for its own entry (a composed call does not),
    // carrying the marker so the subscriber ignores it.
    expect(mockEmitLedgerEvent).toHaveBeenCalledWith(
      'ledger.journal_entry.posted',
      expect.objectContaining({ referenceType: RECLASSIFICATION_REFERENCE_TYPE, referenceId: 'line-1', type: 'NORMAL' }),
    )
  })

  it('tags the zespół 5 line, not the clearing line', async () => {
    const { bus, deps } = setupConfigured()
    await reclassifyLine(deps, buildCandidate())
    expect(bus.tagCalls).toEqual([expect.objectContaining({ journalEntryLineId: 'je-1-line-0' })])
  })
})

describe('reclassifyLine — one reclassification per line, idempotent', () => {
  it('reclassifies two cost lines of one entry separately (marker is per line, not per entry)', async () => {
    const { em, bus, deps } = setupConfigured()
    seedZespol4Account(em, SECOND_SOURCE_ACCOUNT_ID)
    seedRule(em, { id: 'rule-2', sourceAccountId: SECOND_SOURCE_ACCOUNT_ID, targetAccountId: SECOND_TARGET_ACCOUNT_ID })

    const first = await reclassifyLine(deps, buildCandidate({}, { id: 'line-1' }))
    const second = await reclassifyLine(deps, buildCandidate({}, { id: 'line-2', accountId: SECOND_SOURCE_ACCOUNT_ID, debit: '40.00' }))

    expect(first.reclassified).toBe(true)
    expect(second.reclassified).toBe(true)
    expect(bus.postCalls.map((call) => call.input.referenceId)).toEqual(['line-1', 'line-2'])
    expect(bus.postCalls[1].input.lines[0]).toMatchObject({ accountId: SECOND_TARGET_ACCOUNT_ID, debit: '40.00' })
  })

  it('posts only once when the same line is delivered twice', async () => {
    const { bus, deps } = setupConfigured()
    const first = await reclassifyLine(deps, buildCandidate())
    const second = await reclassifyLine(deps, buildCandidate())
    expect(first.reclassified).toBe(true)
    expect(second).toEqual({ reclassified: false, reason: 'already_reclassified' })
    expect(bus.postCalls).toHaveLength(1)
    expect(bus.tagCalls).toHaveLength(1)
  })

  it('does not post when a concurrent worker committed the reclassification while this one waited for the lock', async () => {
    const { em, bus, deps } = setupConfigured()
    em.execute.mockImplementationOnce(async () => {
      seedReclassification(em, 'line-1')
    })
    const result = await reclassifyLine(deps, buildCandidate())
    expect(result).toEqual({ reclassified: false, reason: 'already_reclassified' })
    expect(bus.postCalls).toHaveLength(0)
  })

  it('only ensures the tag when the reclassification exists but its tag is missing (a failed tag step is repaired, not re-posted)', async () => {
    const { em, bus, deps } = setupConfigured()
    seedReclassification(em, 'line-1', { taggedCostCenterId: null })
    const result = await reclassifyLine(deps, buildCandidate())
    expect(result).toEqual({ reclassified: false, reason: 'already_reclassified' })
    expect(bus.postCalls).toHaveLength(0)
    expect(bus.tagCalls).toEqual([
      expect.objectContaining({ journalEntryLineId: 'reclass-of-line-1-target', dimensionIds: [RULE_DEFAULT_COST_CENTER_ID] }),
    ])
  })

  it('recovers from a tag failure on the next pass without a second posting', async () => {
    const { bus, deps } = setupConfigured()
    bus.failNext('journal_entry_line_dimension.setJournalEntryLineDimension', new Error('tag failed'))
    await expect(reclassifyLine(deps, buildCandidate())).rejects.toThrow('tag failed')
    expect(bus.postCalls).toHaveLength(1)

    const retry = await reclassifyLine(deps, buildCandidate())
    expect(retry).toEqual({ reclassified: false, reason: 'already_reclassified' })
    expect(bus.postCalls).toHaveLength(1)
    expect(bus.tagCalls).toHaveLength(1)
  })

  it('does nothing for an already tagged reclassification, even when its rule has since been deleted', async () => {
    const { em, bus, deps } = setupConfigured({ rule: false })
    seedReclassification(em, 'line-1')
    const result = await reclassifyLine(deps, buildCandidate())
    expect(result).toEqual({ reclassified: false, reason: 'already_reclassified' })
    expect(bus.execute).not.toHaveBeenCalled()
  })
})

describe('reclassifyLine — contra side of a REVERSAL: mirror the original per line', () => {
  const ORIGINAL_ENTRY = 'entry-original-1'
  const REVERSAL_ENTRY = 'entry-reversal-1'

  function reversalCandidate(lineId: string) {
    return buildCandidate(
      { id: REVERSAL_ENTRY, type: 'REVERSAL', referenceType: 'journal_entry', referenceId: ORIGINAL_ENTRY },
      { id: lineId, debit: '0', credit: '100.00' },
    )
  }

  it('debits clearing, credits the original target account and reuses the original tag — without consulting the rule', async () => {
    const { em, bus, deps } = setupConfigured({ rule: false }) // no rule: a mirror must not need one
    seedEntry(em, ORIGINAL_ENTRY, [{ id: 'orig-1', accountId: SOURCE_ACCOUNT_ID, debit: '100.00' }])
    seedEntry(em, REVERSAL_ENTRY, [{ id: 'rev-1', accountId: SOURCE_ACCOUNT_ID, credit: '100.00' }], { type: 'REVERSAL', referenceId: ORIGINAL_ENTRY })
    seedReclassification(em, 'orig-1', { taggedCostCenterId: EXPLICIT_COST_CENTER_ID })

    const result = await reclassifyLine(deps, reversalCandidate('rev-1'))

    expect(result.reclassified).toBe(true)
    expect(bus.postCalls[0].input).toMatchObject({ referenceType: RECLASSIFICATION_REFERENCE_TYPE, referenceId: 'rev-1' })
    expect(bus.postCalls[0].input.lines).toEqual([
      expect.objectContaining({ accountId: CLEARING_ACCOUNT_ID, debit: '100.00' }),
      expect.objectContaining({ accountId: TARGET_ACCOUNT_ID, credit: '100.00' }),
    ])
    // The mirror's zespół 5 (credit) line carries the original's cost centre.
    expect(bus.tagCalls).toEqual([expect.objectContaining({ journalEntryLineId: 'je-1-line-1', dimensionIds: [EXPLICIT_COST_CENTER_ID] })])
  })

  it('falls back to the sentinel when the original reclassification line carries no tag', async () => {
    const { em, bus, deps } = setupConfigured({ rule: false })
    seedEntry(em, ORIGINAL_ENTRY, [{ id: 'orig-1', accountId: SOURCE_ACCOUNT_ID, debit: '100.00' }])
    seedEntry(em, REVERSAL_ENTRY, [{ id: 'rev-1', accountId: SOURCE_ACCOUNT_ID, credit: '100.00' }], { type: 'REVERSAL', referenceId: ORIGINAL_ENTRY })
    seedReclassification(em, 'orig-1', { taggedCostCenterId: null })

    await reclassifyLine(deps, reversalCandidate('rev-1'))
    expect(bus.tagCalls).toEqual([expect.objectContaining({ dimensionIds: [SENTINEL_COST_CENTER_ID] })])
  })

  it('pairs identical lines one to one: each reversal line mirrors its own original, whatever the processing order', async () => {
    const { em, bus, deps } = setupConfigured({ rule: false })
    seedEntry(em, ORIGINAL_ENTRY, [
      { id: 'orig-a', accountId: SOURCE_ACCOUNT_ID, debit: '100.00' },
      { id: 'orig-b', accountId: SOURCE_ACCOUNT_ID, debit: '100.00' },
    ])
    seedEntry(
      em,
      REVERSAL_ENTRY,
      [
        { id: 'rev-a', accountId: SOURCE_ACCOUNT_ID, credit: '100.00' },
        { id: 'rev-b', accountId: SOURCE_ACCOUNT_ID, credit: '100.00' },
      ],
      { type: 'REVERSAL', referenceId: ORIGINAL_ENTRY },
    )
    seedCostCenter(em, 'cc-a')
    seedCostCenter(em, 'cc-b')
    seedReclassification(em, 'orig-a', { targetAccountId: TARGET_ACCOUNT_ID, taggedCostCenterId: 'cc-a' })
    seedReclassification(em, 'orig-b', { targetAccountId: SECOND_TARGET_ACCOUNT_ID, taggedCostCenterId: 'cc-b' })

    await reclassifyLine(deps, reversalCandidate('rev-b'))
    await reclassifyLine(deps, reversalCandidate('rev-a'))

    expect(bus.postCalls.map((call) => [call.input.referenceId, call.input.lines[1].accountId])).toEqual([
      ['rev-b', SECOND_TARGET_ACCOUNT_ID],
      ['rev-a', TARGET_ACCOUNT_ID],
    ])
    expect(bus.tagCalls.map((call) => call.dimensionIds[0])).toEqual(['cc-b', 'cc-a'])
  })

  it('repairs a missing tag on an existing mirror with the original\'s cost centre, not a re-resolved one', async () => {
    const { em, bus, deps } = setupConfigured() // the rule default would give cc-rule-default
    seedEntry(em, ORIGINAL_ENTRY, [{ id: 'orig-1', accountId: SOURCE_ACCOUNT_ID, debit: '100.00' }])
    seedEntry(em, REVERSAL_ENTRY, [{ id: 'rev-1', accountId: SOURCE_ACCOUNT_ID, credit: '100.00' }], { type: 'REVERSAL', referenceId: ORIGINAL_ENTRY })
    seedReclassification(em, 'orig-1', { taggedCostCenterId: EXPLICIT_COST_CENTER_ID })
    seedReclassification(em, 'rev-1', { taggedCostCenterId: null }) // mirror posted, tag step failed

    const result = await reclassifyLine(deps, reversalCandidate('rev-1'))

    expect(result).toEqual({ reclassified: false, reason: 'already_reclassified' })
    expect(bus.postCalls).toHaveLength(0)
    expect(bus.tagCalls).toEqual([expect.objectContaining({ journalEntryLineId: 'reclass-of-rev-1-target', dimensionIds: [EXPLICIT_COST_CENTER_ID] })])
  })

  it('does not mirror a reclassification of a different line of the reversed entry', async () => {
    const { em, bus, deps } = setupConfigured({ rule: false })
    seedZespol4Account(em, SECOND_SOURCE_ACCOUNT_ID)
    seedEntry(em, ORIGINAL_ENTRY, [
      { id: 'orig-a', accountId: SOURCE_ACCOUNT_ID, debit: '100.00' },
      { id: 'orig-b', accountId: SECOND_SOURCE_ACCOUNT_ID, debit: '100.00' },
    ])
    seedEntry(em, REVERSAL_ENTRY, [{ id: 'rev-b', accountId: SECOND_SOURCE_ACCOUNT_ID, credit: '100.00' }], { type: 'REVERSAL', referenceId: ORIGINAL_ENTRY })
    seedReclassification(em, 'orig-a', { targetAccountId: TARGET_ACCOUNT_ID })
    seedReclassification(em, 'orig-b', { targetAccountId: SECOND_TARGET_ACCOUNT_ID })

    await reclassifyLine(deps, buildCandidate({ id: REVERSAL_ENTRY, type: 'REVERSAL', referenceId: ORIGINAL_ENTRY }, { id: 'rev-b', accountId: SECOND_SOURCE_ACCOUNT_ID, debit: '0', credit: '100.00' }))
    expect(bus.postCalls[0].input.lines[1]).toMatchObject({ accountId: SECOND_TARGET_ACCOUNT_ID })
  })
})

describe('reclassifyLine — contra side with no original: post the inverted direction', () => {
  function expectInverted(bus: ReturnType<typeof buildFakeCommandBus>) {
    expect(bus.postCalls[0].input.lines).toEqual([
      expect.objectContaining({ accountId: CLEARING_ACCOUNT_ID, debit: '100.00' }),
      expect.objectContaining({ accountId: TARGET_ACCOUNT_ID, credit: '100.00' }),
    ])
    expect(bus.tagCalls).toEqual([expect.objectContaining({ journalEntryLineId: 'je-1-line-1', dimensionIds: [RULE_DEFAULT_COST_CENTER_ID] })])
  }

  it('a credit on a cost account in an ordinary entry (vendor credit note, 4xx -> 4xx) is resolved through the rule and inverted', async () => {
    const { bus, deps } = setupConfigured()
    const result = await reclassifyLine(deps, buildCandidate({}, { debit: '0', credit: '100.00' }))
    expect(result.reclassified).toBe(true)
    expectInverted(bus)
  })

  it('a reversal whose original line was never reclassified is resolved through the rule and inverted', async () => {
    const { em, bus, deps } = setupConfigured()
    seedEntry(em, 'entry-original-1', [{ id: 'orig-1', accountId: SOURCE_ACCOUNT_ID, debit: '100.00' }])
    seedEntry(em, 'entry-reversal-1', [{ id: 'rev-1', accountId: SOURCE_ACCOUNT_ID, credit: '100.00' }], { type: 'REVERSAL', referenceId: 'entry-original-1' })
    await reclassifyLine(
      deps,
      buildCandidate({ id: 'entry-reversal-1', type: 'REVERSAL', referenceId: 'entry-original-1' }, { id: 'rev-1', debit: '0', credit: '100.00' }),
    )
    expectInverted(bus)
  })

  it('a reversal without a referenceId no longer fails: it is resolved through the rule and inverted', async () => {
    const { bus, deps } = setupConfigured()
    const result = await reclassifyLine(deps, buildCandidate({ type: 'REVERSAL', referenceId: null }, { debit: '0', credit: '100.00' }))
    expect(result.reclassified).toBe(true)
    expectInverted(bus)
  })
})
