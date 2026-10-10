import { suppressSimulationGroup, suppressSimulationGroups } from '../privacy'

const CELLS = ['fires', 'does_not_fire', 'runs_failure_actions', 'cannot_tell']

function group(counts: Record<string, number>, extra: Record<string, unknown> = {}) {
  return {
    key: 'customers.deal.updated',
    sampleResourceKind: 'customers.deal',
    cells: Object.entries(counts).map(([key, count]) => ({ key, count, sampleIds: [`${key}-1`, `${key}-2`] })),
    ...extra,
  }
}

describe('simulation k-suppression (S14)', () => {
  it('reports every cell at or above k with its samples and keeps zero cells visible', () => {
    const result = suppressSimulationGroup(group({ fires: 12, does_not_fire: 0, runs_failure_actions: 30 }), 10, CELLS)
    expect(result.total).toBe(42)
    expect(result.suppressed).toBe(false)
    expect(result.cells).toEqual([
      { key: 'fires', count: 12, suppressed: null, sampleIds: ['fires-1', 'fires-2'] },
      { key: 'does_not_fire', count: 0, suppressed: null, sampleIds: ['does_not_fire-1', 'does_not_fire-2'] },
      { key: 'runs_failure_actions', count: 30, suppressed: null, sampleIds: ['runs_failure_actions-1', 'runs_failure_actions-2'] },
      { key: 'cannot_tell', count: 0, suppressed: null, sampleIds: [] },
    ])
  })

  it('suppresses a whole group with fewer than k records, including zero cells and data warnings', () => {
    const result = suppressSimulationGroup(group({ fires: 3, does_not_fire: 0 }, { warnings: ['structural'], dataWarnings: ['neverFires'] }), 10, CELLS)
    expect(result).toEqual(expect.objectContaining({ total: null, suppressed: true, warnings: ['structural'] }))
    expect(result.cells.every((cell) => cell.count === null && cell.suppressed === 'below_k' && cell.sampleIds.length === 0)).toBe(true)
  })

  it('marks a small cell as below k and hides the smallest sibling so the total cannot reveal it', () => {
    const result = suppressSimulationGroup(group({ fires: 3, does_not_fire: 40, runs_failure_actions: 25, cannot_tell: 0 }), 10, CELLS)
    expect(result.total).toBe(68)
    const byKey = Object.fromEntries(result.cells.map((cell) => [cell.key, cell]))
    expect(byKey.fires).toEqual({ key: 'fires', count: null, suppressed: 'below_k', sampleIds: [] })
    expect(byKey.runs_failure_actions).toEqual({ key: 'runs_failure_actions', count: null, suppressed: 'complementary', sampleIds: [] })
    expect(byKey.does_not_fire.count).toBe(40)
    expect(byKey.cannot_tell.count).toBe(0)
  })

  it('needs no complementary suppression when the suppressed cells together reach k', () => {
    const result = suppressSimulationGroup(group({ fires: 6, does_not_fire: 7, runs_failure_actions: 30 }), 10, CELLS)
    const suppressedKeys = result.cells.filter((cell) => cell.suppressed).map((cell) => [cell.key, cell.suppressed])
    expect(suppressedKeys).toEqual([['fires', 'below_k'], ['does_not_fire', 'below_k']])
  })

  it('shows data warnings only for visible groups, normalizes cells and never leaks unknown sample shapes', () => {
    const [visible] = suppressSimulationGroups([{
      key: 'customers.deal.created',
      cells: [{ key: 'fires', count: 20, sampleIds: ['a', 'a', '', 'b'] }, { key: 'extra', count: -5 }, { key: 'fires', count: 1 }],
      dataWarnings: ['neverFires'],
      warnings: ['structural'],
      flags: ['rule_limit_exceeded'],
    }], 10, CELLS)
    expect(visible.warnings).toEqual(['structural', 'neverFires'])
    expect(visible.flags).toEqual(['rule_limit_exceeded'])
    expect(visible.cells.map((cell) => cell.key)).toEqual([...CELLS, 'extra'])
    expect(visible.cells[0]).toEqual({ key: 'fires', count: 21, suppressed: null, sampleIds: ['a', 'b'] })
    expect(visible.cells[4].count).toBe(0)
    expect(visible.sampleResourceKind).toBeNull()
  })

  it('treats an empty group as visible zeros', () => {
    const result = suppressSimulationGroup(group({}), 10, CELLS)
    expect(result).toEqual(expect.objectContaining({ total: 0, suppressed: false }))
    expect(result.cells.every((cell) => cell.count === 0 && cell.suppressed === null)).toBe(true)
  })
})
