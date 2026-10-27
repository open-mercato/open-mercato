import { layoutFloors, minimumCounts } from '../../lib/floorNumbering'
import type { FloorRow } from './buildingRecord'

export function relayFloorRows(current: readonly FloorRow[], below: number, above: number): FloorRow[] {
  const byNumber = new Map(current.map((row) => [row.number, row]))
  return layoutFloors(below, above).map((number) => byNumber.get(number) ?? {
    id: null,
    number,
    name: '',
    sizeX: '',
    sizeY: '',
    spaceCount: 0,
    unitCount: 0,
  })
}

export type FloorCountIssue = { field: 'below' | 'above'; minimum: number; floor: FloorRow }

export function findCountIssue(saved: readonly FloorRow[], below: number, above: number): FloorCountIssue | null {
  const counts = minimumCounts(saved.map((row) => ({ number: row.number, unitCount: row.unitCount })))
  if (below < counts.minimumBelow && counts.blockingBelow !== null) {
    const floor = saved.find((row) => row.number === counts.blockingBelow)
    if (floor) return { field: 'below', minimum: counts.minimumBelow, floor }
  }
  if (above < counts.minimumAbove && counts.blockingAbove !== null) {
    const floor = saved.find((row) => row.number === counts.blockingAbove)
    if (floor) return { field: 'above', minimum: counts.minimumAbove, floor }
  }
  return null
}

export function parseCount(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback
}

export function parseMetres(value: string): number | null {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function readFloorRows(value: unknown): FloorRow[] {
  return Array.isArray(value) ? (value as FloorRow[]) : []
}
