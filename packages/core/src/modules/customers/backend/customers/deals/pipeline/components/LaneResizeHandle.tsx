"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

type LaneResizeHandleProps = {
  /** Called with the cumulative delta (px) as the user drags. */
  onResize: (deltaPx: number) => void
  /** Called once when the drag ends. */
  onResizeEnd?: () => void
  /** Called on double-click — convention is "reset this lane to default width". */
  onReset?: () => void
}

/**
 * Thin vertical drag handle that sits on the right edge of a kanban lane.
 *
 * UX (matches Monday / Asana / ClickUp):
 * - Hover: 4 px column highlights, cursor flips to `col-resize`
 * - Drag: lane width updates live via `onResize`
 * - Double-click: emits `onReset` (the lane resets to its default width)
 *
 * The pointer listeners attach to `window` during the drag so the handle keeps tracking
 * even when the cursor moves off the handle's narrow hit area.
 */
export function LaneResizeHandle({ onResize, onResizeEnd, onReset }: LaneResizeHandleProps): React.ReactElement {
  const t = useT()
  const dragStateRef = React.useRef<{ lastX: number } | null>(null)
  const [isActive, setIsActive] = React.useState(false)

  const stopDrag = React.useCallback(
    (handlers: { move: (e: PointerEvent) => void; up: () => void }) => {
      window.removeEventListener('pointermove', handlers.move)
      window.removeEventListener('pointerup', handlers.up)
      window.removeEventListener('pointercancel', handlers.up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsActive(false)
      onResizeEnd?.()
      dragStateRef.current = null
    },
    [onResizeEnd],
  )

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      // Only respond to primary (left) mouse button / touch / pen
      if (event.button !== 0 && event.pointerType === 'mouse') return
      event.preventDefault()
      event.stopPropagation()
      setIsActive(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      dragStateRef.current = { lastX: event.clientX }

      const handlers = {
        move: (e: PointerEvent) => {
          if (!dragStateRef.current) return
          const delta = e.clientX - dragStateRef.current.lastX
          if (delta !== 0) {
            dragStateRef.current.lastX = e.clientX
            onResize(delta)
          }
        },
        up: () => stopDrag(handlers),
      }
      window.addEventListener('pointermove', handlers.move)
      window.addEventListener('pointerup', handlers.up)
      window.addEventListener('pointercancel', handlers.up)
    },
    [onResize, stopDrag],
  )

  const handleDoubleClick = React.useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      onReset?.()
    },
    [onReset],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={translateWithFallback(
        t,
        'customers.deals.kanban.lane.resizeHandle',
        'Drag to resize column. Double-click to reset width.',
      )}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      title={translateWithFallback(
        t,
        'customers.deals.kanban.lane.resizeHandle',
        'Drag to resize · double-click to reset',
      )}
      className={`absolute -right-0.5 top-0 z-20 h-full w-1.5 cursor-col-resize touch-none select-none ${
        isActive ? 'bg-accent-indigo/40' : 'bg-transparent hover:bg-accent-indigo/20'
      }`}
    />
  )
}

export default LaneResizeHandle
