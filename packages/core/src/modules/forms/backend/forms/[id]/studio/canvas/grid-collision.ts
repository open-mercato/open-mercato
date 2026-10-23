// Decision 2a — gap droppables win over cells when the pointer is inside one.
import {
  closestCenter,
  closestCorners,
  pointerWithin,
  type Collision,
  type CollisionDetection,
} from '@dnd-kit/core'
import { parseSectionDropId } from './GridSlot'

function isGapCollision(collision: Collision): boolean {
  const parsed = parseSectionDropId(String(collision.id))
  return parsed?.kind === 'col-gap' || parsed?.kind === 'row-gap'
}

export const gridAwareCollision: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args)
  if (pointerHits.length > 0) {
    const gapHits = pointerHits.filter(isGapCollision)
    if (gapHits.length > 0) return gapHits
  }
  const cornerHits = closestCorners(args)
  if (cornerHits.length > 0) return cornerHits
  return closestCenter(args)
}
