import type { LayoutFloorSummary } from './types'

const TARGET_DRAWING_PX = 960
const MIN_PX_PER_METRE = 8
const MAX_PX_PER_METRE = 48

export function pixelsPerMetre(floors: readonly LayoutFloorSummary[], fallbackWidth: number): number {
  const widest = floors.reduce((max, floor) => Math.max(max, floor.sizeX), fallbackWidth)
  if (!Number.isFinite(widest) || widest <= 0) return MAX_PX_PER_METRE
  return Math.min(MAX_PX_PER_METRE, Math.max(MIN_PX_PER_METRE, Math.floor(TARGET_DRAWING_PX / widest)))
}

export function rectStyle(rect: { x: number; y: number; width: number; depth: number }, sizeX: number, sizeY: number): { left: string; top: string; width: string; height: string } {
  const safeX = sizeX > 0 ? sizeX : 1
  const safeY = sizeY > 0 ? sizeY : 1
  return {
    left: `${(rect.x / safeX) * 100}%`,
    top: `${(rect.y / safeY) * 100}%`,
    width: `${(rect.width / safeX) * 100}%`,
    height: `${(rect.depth / safeY) * 100}%`,
  }
}
