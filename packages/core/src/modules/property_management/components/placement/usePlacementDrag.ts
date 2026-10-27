"use client"

import * as React from 'react'
import { clampInto, floorRect, PLACEMENT_SNAP, snapTo } from '../../lib/geometry'
import type { LayoutRect } from '../floor/types'

export type PlacementDragOptions = {
  rect: LayoutRect
  sizeX: number
  sizeY: number
  disabled?: boolean
  onMove: (position: { x: number; y: number }) => void
  onSettle: (rect: LayoutRect) => void
}

type DragStart = { pointerId: number; clientX: number; clientY: number; x: number; y: number }

const KEY_DELTAS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

export function usePlacementDrag({ rect, sizeX, sizeY, disabled, onMove, onSettle }: PlacementDragOptions) {
  const floorRef = React.useRef<HTMLDivElement | null>(null)
  const startRef = React.useRef<DragStart | null>(null)
  const latestRef = React.useRef<LayoutRect>(rect)
  const [dragging, setDragging] = React.useState(false)
  latestRef.current = rect

  const place = React.useCallback((x: number, y: number): LayoutRect => {
    const snapped = { ...latestRef.current, x: snapTo(x, PLACEMENT_SNAP), y: snapTo(y, PLACEMENT_SNAP) }
    return clampInto(snapped, floorRect(sizeX, sizeY))
  }, [sizeX, sizeY])

  const metresPerPixel = React.useCallback((): number => {
    const width = floorRef.current?.getBoundingClientRect().width ?? 0
    return width > 0 && sizeX > 0 ? sizeX / width : 0
  }, [sizeX])

  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus()
    startRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: latestRef.current.x,
      y: latestRef.current.y,
    }
    setDragging(true)
  }, [disabled])

  const onPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const scale = metresPerPixel()
    if (!scale) return
    const next = place(start.x + (event.clientX - start.clientX) * scale, start.y + (event.clientY - start.clientY) * scale)
    if (next.x !== latestRef.current.x || next.y !== latestRef.current.y) onMove({ x: next.x, y: next.y })
  }, [metresPerPixel, onMove, place])

  const finish = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start || start.pointerId !== event.pointerId) return
    startRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    onSettle(latestRef.current)
  }, [onSettle])

  const onKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = KEY_DELTAS[event.key]
    if (!delta || disabled) return
    event.preventDefault()
    const step = event.shiftKey ? 1 : PLACEMENT_SNAP
    const next = place(latestRef.current.x + delta.dx * step, latestRef.current.y + delta.dy * step)
    onMove({ x: next.x, y: next.y })
    onSettle(next)
  }, [disabled, onMove, onSettle, place])

  return {
    floorRef,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onKeyDown },
  }
}
