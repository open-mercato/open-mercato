import type { SimulationGroup } from '@open-mercato/shared/modules/insights/simulate'
import { compareCodeUnits } from '../process/registry'
import { SIMULATION_SAMPLE_CANDIDATES } from './constants'

export type SimulationCellSuppression = 'below_k' | 'complementary'

export type SimulationResultCell = {
  key: string
  count: number | null
  suppressed: SimulationCellSuppression | null
  sampleIds: string[]
}

export type SimulationResultGroup = {
  key: string
  labelKey: string | null
  sampleResourceKind: string | null
  total: number | null
  suppressed: boolean
  cells: SimulationResultCell[]
  warnings: string[]
  flags: string[]
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function uniqueStrings(values: readonly unknown[] | undefined, limit: number): string[] {
  const result: string[] = []
  for (const value of values ?? []) {
    if (typeof value !== 'string' || value.length === 0 || result.includes(value)) continue
    result.push(value)
    if (result.length >= limit) break
  }
  return result
}

function orderedCells(group: SimulationGroup, cellKeys: readonly string[]): Array<{ key: string; count: number; sampleIds: string[] }> {
  const byKey = new Map<string, { key: string; count: number; sampleIds: string[] }>()
  for (const cell of group.cells ?? []) {
    if (!cell || typeof cell.key !== 'string' || cell.key.length === 0) continue
    const existing = byKey.get(cell.key)
    const sampleIds = uniqueStrings(cell.sampleIds, SIMULATION_SAMPLE_CANDIDATES)
    if (existing) {
      existing.count += toCount(cell.count)
      existing.sampleIds = uniqueStrings([...existing.sampleIds, ...sampleIds], SIMULATION_SAMPLE_CANDIDATES)
    } else {
      byKey.set(cell.key, { key: cell.key, count: toCount(cell.count), sampleIds })
    }
  }
  const ordered = cellKeys.map((key) => byKey.get(key) ?? { key, count: 0, sampleIds: [] })
  const extra = Array.from(byKey.values()).filter((cell) => !cellKeys.includes(cell.key)).sort((left, right) => compareCodeUnits(left.key, right.key))
  return [...ordered, ...extra]
}

/**
 * S14 k-suppression of one result group. A group with fewer than k (but some) records is
 * suppressed as a whole: no total, no counts, no samples, no count-derived warnings. Otherwise a
 * non-zero cell below k is reported as "fewer than k" (`below_k`); when some cells are suppressed
 * and their union is still below k, the smallest visible non-zero cells are suppressed too
 * (`complementary`), so the visible total can never be subtracted down to a small group. A zero
 * cell describes no record and stays visible. Sample ids survive only on visible cells.
 */
export function suppressSimulationGroup(group: SimulationGroup, k: number, cellKeys: readonly string[]): SimulationResultGroup {
  const cells = orderedCells(group, cellKeys)
  const total = cells.reduce((sum, cell) => sum + cell.count, 0)
  const base = {
    key: group.key,
    labelKey: typeof group.labelKey === 'string' && group.labelKey.length > 0 ? group.labelKey : null,
    sampleResourceKind: typeof group.sampleResourceKind === 'string' && group.sampleResourceKind.length > 0 ? group.sampleResourceKind : null,
    warnings: uniqueStrings(group.warnings, 32),
    flags: uniqueStrings(group.flags, 32),
  }
  if (total > 0 && total < k) {
    return {
      ...base,
      total: null,
      suppressed: true,
      cells: cells.map((cell) => ({ key: cell.key, count: null, suppressed: 'below_k', sampleIds: [] })),
    }
  }
  const suppression = new Map<string, SimulationCellSuppression>()
  let suppressedUnion = 0
  for (const cell of cells) {
    if (cell.count > 0 && cell.count < k) {
      suppression.set(cell.key, 'below_k')
      suppressedUnion += cell.count
    }
  }
  if (suppression.size > 0 && suppressedUnion < k) {
    const candidates = cells
      .filter((cell) => cell.count > 0 && !suppression.has(cell.key))
      .sort((left, right) => left.count - right.count || compareCodeUnits(left.key, right.key))
    for (const candidate of candidates) {
      if (suppressedUnion >= k) break
      suppression.set(candidate.key, 'complementary')
      suppressedUnion += candidate.count
    }
  }
  const warnings = [...base.warnings, ...uniqueStrings(group.dataWarnings, 32).filter((warning) => !base.warnings.includes(warning))]
  return {
    ...base,
    warnings,
    total,
    suppressed: false,
    cells: cells.map((cell) => {
      const reason = suppression.get(cell.key) ?? null
      return {
        key: cell.key,
        count: reason ? null : cell.count,
        suppressed: reason,
        sampleIds: reason ? [] : cell.sampleIds,
      }
    }),
  }
}

export function suppressSimulationGroups(groups: readonly SimulationGroup[], k: number, cellKeys: readonly string[]): SimulationResultGroup[] {
  return groups.map((group) => suppressSimulationGroup(group, k, cellKeys))
}
