/**
 * New-node placement (#4248).
 *
 * A dropped node lands under the cursor, a click-appended node lands after the
 * right-most card, and neither is ever stacked on top of an existing card.
 */

import { describe, test, expect } from '@jest/globals'
import { resolveNewNodePlacement, type NodeFootprint } from '../node-placement'

const at = (x: number, y: number, measured?: { width: number; height: number }): NodeFootprint => ({
  position: { x, y },
  ...(measured ? { measured } : {}),
})

describe('resolveNewNodePlacement — drop position', () => {
  test('centres the card on the cursor', () => {
    const placement = resolveNewNodePlacement([], { dropPosition: { x: 500, y: 300 }, width: 180, height: 84 })
    expect(placement).toEqual({ x: 410, y: 258 })
  })

  test('pushes the card clear when the cursor lands on an existing node', () => {
    const nodes = [at(400, 240, { width: 180, height: 84 })]
    const placement = resolveNewNodePlacement(nodes, {
      dropPosition: { x: 500, y: 300 },
      width: 180,
      height: 84,
      gap: 48,
    })
    expect(placement.x).toBe(410)
    expect(placement.y).toBeGreaterThanOrEqual(240 + 84)
  })

  test('honours a cursor position that is already free', () => {
    const nodes = [at(0, 0, { width: 180, height: 84 })]
    const placement = resolveNewNodePlacement(nodes, { dropPosition: { x: 900, y: 40 }, width: 180, height: 84 })
    expect(placement).toEqual({ x: 810, y: -2 })
  })
})

describe('resolveNewNodePlacement — click append', () => {
  test('places the first node at the origin', () => {
    expect(resolveNewNodePlacement([])).toEqual({ x: 0, y: 0 })
  })

  test('places after the right-most card, aligned with it', () => {
    const nodes = [
      at(0, 0, { width: 180, height: 84 }),
      at(300, 120, { width: 200, height: 84 }),
      at(120, 400, { width: 180, height: 84 }),
    ]
    const placement = resolveNewNodePlacement(nodes, { width: 180, height: 84, gap: 48 })
    expect(placement).toEqual({ x: 548, y: 120 })
  })

  test('never overlaps an existing card', () => {
    const nodes = [at(0, 0, { width: 180, height: 84 }), at(228, 0, { width: 180, height: 84 })]
    const placement = resolveNewNodePlacement(nodes, { width: 180, height: 84, gap: 48 })
    const overlapsAny = nodes.some((node) => {
      const width = node.measured?.width ?? 180
      const height = node.measured?.height ?? 84
      return (
        placement.x < node.position.x + width &&
        placement.x + 180 > node.position.x &&
        placement.y < node.position.y + height &&
        placement.y + 84 > node.position.y
      )
    })
    expect(overlapsAny).toBe(false)
  })

  test('falls back to the estimated footprint for unmeasured nodes', () => {
    const placement = resolveNewNodePlacement([at(0, 0)], { width: 180, height: 84, gap: 48 })
    expect(placement).toEqual({ x: 228, y: 0 })
  })
})
