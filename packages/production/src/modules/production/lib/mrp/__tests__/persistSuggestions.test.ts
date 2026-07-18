export {}

import { persistMrpSuggestions } from '../persistSuggestions'
import { MrpSuggestion } from '../../../data/entities'
import type { MrpSuggestion as EngineSuggestion } from '../types'

/**
 * Task 5.2 — `persistMrpSuggestions` (TDD, `[tdd:required]`).
 *
 * DoD under test: "a second run does not re-emit suggestions equivalent to
 * accepted/dismissed ones" (carry-over) AND "rerun of a failed/same run
 * supersedes partial output" (idempotent retry).
 */

type Row = Record<string, unknown> & { id: string }

function makeFakeEm() {
  let nextId = 1
  const rows: Row[] = []
  const nativeDeleteCalls: Array<Record<string, unknown>> = []
  const nativeUpdateCalls: Array<{ where: Record<string, unknown>; set: Record<string, unknown> }> = []

  function matches(row: Row, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$in' in (value as Record<string, unknown>)) {
        const list = (value as { $in: unknown[] }).$in
        return list.includes(row[key])
      }
      if (value === null) return row[key] === null || row[key] === undefined
      return row[key] === value
    })
  }

  const em: any = {
    find: jest.fn(async (_Entity: unknown, filter: Record<string, unknown> = {}) => {
      return rows.filter((row) => matches(row, filter))
    }),
    create: jest.fn((_Entity: unknown, data: Record<string, unknown>) => {
      const row: Row = { id: `gen-${nextId++}`, createdAt: new Date(), ...data } as Row
      return row
    }),
    persist: jest.fn((rowOrRows: Row | Row[]) => {
      const toAdd = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
      for (const row of toAdd) rows.push(row)
    }),
    flush: jest.fn(async () => undefined),
    nativeDelete: jest.fn(async (_Entity: unknown, filter: Record<string, unknown>) => {
      nativeDeleteCalls.push(filter)
      const toDelete = rows.filter((row) => matches(row, filter))
      for (const row of toDelete) {
        const idx = rows.indexOf(row)
        if (idx >= 0) rows.splice(idx, 1)
      }
    }),
    nativeUpdate: jest.fn(async (_Entity: unknown, filter: Record<string, unknown>, set: Record<string, unknown>) => {
      nativeUpdateCalls.push({ where: filter, set })
      for (const row of rows.filter((r) => matches(r, filter))) {
        Object.assign(row, set)
      }
    }),
  }

  return { em, rows, nativeDeleteCalls, nativeUpdateCalls }
}

function seedRow(rows: Row[], overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: overrides.id ?? `seed-${rows.length + 1}`,
    tenantId: 't1',
    organizationId: 'o1',
    runId: 'run-old',
    suggestionType: 'make',
    productId: 'p1',
    variantId: null,
    qty: '10',
    uom: 'pcs',
    dueDate: new Date('2026-02-01'),
    demandSource: [{ productKey: 'p1::', source: { type: 'sales_order', id: 'so-1' }, qty: 10 }],
    status: 'open',
    carriedFromSuggestionId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
  rows.push(row)
  return row
}

function engineSuggestion(overrides: Partial<EngineSuggestion> = {}): EngineSuggestion {
  return {
    type: 'make',
    productKey: 'p1::',
    productId: 'p1',
    variantId: null,
    qty: 10,
    uom: 'pcs',
    dueDate: '2026-03-01',
    pegging: [{ productKey: 'p1::', source: { type: 'sales_order', id: 'so-1' }, qty: 10 }],
    ...overrides,
  }
}

describe('persistMrpSuggestions', () => {
  it('inserts new suggestions as open when there is no prior resolved match', async () => {
    const { em } = makeFakeEm()
    const summary = await persistMrpSuggestions({
      em,
      runId: 'run-1',
      tenantId: 't1',
      organizationId: 'o1',
      suggestions: [engineSuggestion()],
    })
    expect(summary.inserted).toBe(1)
    expect(summary.openCount).toBe(1)
    expect(summary.carriedCount).toBe(0)
  })

  it('DoD: a suggestion matching a prior ACCEPTED suggestion is inserted as superseded, not open (no duplicate noise)', async () => {
    const { em, rows } = makeFakeEm()
    seedRow(rows, { id: 'accepted-1', status: 'accepted', runId: 'run-old' })

    const summary = await persistMrpSuggestions({
      em,
      runId: 'run-2',
      tenantId: 't1',
      organizationId: 'o1',
      suggestions: [engineSuggestion()],
    })

    expect(summary.carriedCount).toBe(1)
    expect(summary.openCount).toBe(0)
    const inserted = rows.find((row) => row.runId === 'run-2')!
    expect(inserted.status).toBe('superseded')
    expect(inserted.carriedFromSuggestionId).toBe('accepted-1')
  })

  it('DoD: a suggestion matching a prior DISMISSED suggestion is inserted as superseded, not open', async () => {
    const { em, rows } = makeFakeEm()
    seedRow(rows, { id: 'dismissed-1', status: 'dismissed', runId: 'run-old' })

    await persistMrpSuggestions({
      em,
      runId: 'run-2',
      tenantId: 't1',
      organizationId: 'o1',
      suggestions: [engineSuggestion()],
    })

    const inserted = rows.find((row) => row.runId === 'run-2')!
    expect(inserted.status).toBe('superseded')
    expect(inserted.carriedFromSuggestionId).toBe('dismissed-1')
  })

  it('marks prior OPEN suggestions from an earlier run as superseded (the new run replaces them)', async () => {
    const { em, rows } = makeFakeEm()
    seedRow(rows, { id: 'prior-open-1', status: 'open', runId: 'run-old' })

    await persistMrpSuggestions({
      em,
      runId: 'run-2',
      tenantId: 't1',
      organizationId: 'o1',
      suggestions: [],
    })

    const priorOpen = rows.find((row) => row.id === 'prior-open-1')!
    expect(priorOpen.status).toBe('superseded')
  })

  it('idempotent retry: wipes partial rows already inserted for the SAME runId before inserting the fresh set', async () => {
    const { em, rows, nativeDeleteCalls } = makeFakeEm()
    // Simulate a partial write from a crashed prior attempt of run-1.
    seedRow(rows, { id: 'partial-1', status: 'open', runId: 'run-1' })

    const summary = await persistMrpSuggestions({
      em,
      runId: 'run-1',
      tenantId: 't1',
      organizationId: 'o1',
      suggestions: [engineSuggestion({ productId: 'p2', productKey: 'p2::', pegging: [] })],
    })

    expect(nativeDeleteCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ runId: 'run-1' })]),
    )
    expect(rows.find((row) => row.id === 'partial-1')).toBeUndefined()
    expect(summary.inserted).toBe(1)
    expect(rows.filter((row) => row.runId === 'run-1')).toHaveLength(1)
  })

  it('REGRESSION: a multi-pegging-source suggestion carries over even when the second run feeds the same pegging refs in REVERSED order', async () => {
    const { em, rows } = makeFakeEm()

    // Run 1: suggestion has two pegging sources (e.g. two sales order lines
    // rolled up into one suggestion), accepted by a user.
    const multiPegging = [
      { productKey: 'p1::', source: { type: 'sales_order' as const, id: 'so-1' }, qty: 4 },
      { productKey: 'p1::', source: { type: 'sales_order' as const, id: 'so-2' }, qty: 6 },
    ]
    seedRow(rows, {
      id: 'accepted-multi',
      status: 'accepted',
      runId: 'run-1',
      demandSource: multiPegging,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })

    // Run 2: an unordered upstream query returned the SAME two demands but in
    // REVERSED order -- pegging on the newly computed suggestion is reversed
    // relative to what was persisted/accepted in run 1.
    const reversedPegging = [...multiPegging].reverse()
    const summary = await persistMrpSuggestions({
      em,
      runId: 'run-2',
      tenantId: 't1',
      organizationId: 'o1',
      suggestions: [engineSuggestion({ pegging: reversedPegging })],
    })

    expect(summary.carriedCount).toBe(1)
    expect(summary.openCount).toBe(0)
    const inserted = rows.find((row) => row.runId === 'run-2')!
    expect(inserted.status).toBe('superseded')
    expect(inserted.carriedFromSuggestionId).toBe('accepted-multi')
  })

  it('does not touch already-resolved (accepted/dismissed) rows when superseding prior open rows', async () => {
    const { em, rows } = makeFakeEm()
    seedRow(rows, { id: 'accepted-untouched', status: 'accepted', runId: 'run-old' })
    seedRow(rows, { id: 'open-to-supersede', status: 'open', runId: 'run-old', productId: 'p9' })

    await persistMrpSuggestions({
      em,
      runId: 'run-2',
      tenantId: 't1',
      organizationId: 'o1',
      suggestions: [],
    })

    expect(rows.find((row) => row.id === 'accepted-untouched')!.status).toBe('accepted')
    expect(rows.find((row) => row.id === 'open-to-supersede')!.status).toBe('superseded')
  })
})
