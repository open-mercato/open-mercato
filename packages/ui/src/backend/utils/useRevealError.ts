"use client"

import * as React from 'react'

export function useRevealError(
  targetRef: React.RefObject<HTMLElement | null>,
  rejection: object | number | null | undefined,
) {
  React.useEffect(() => {
    if (rejection === null || rejection === undefined) return

    const frame = window.requestAnimationFrame(() => {
      const target = targetRef.current
      if (!target?.isConnected) return
      target.focus({ preventScroll: true })
      target.scrollIntoView?.({ behavior: 'instant', block: 'start', inline: 'nearest' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [rejection, targetRef])
}
