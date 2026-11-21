"use client"

import * as React from 'react'

function isStartVisible(target: HTMLElement): boolean {
  const bounds = target.getBoundingClientRect()
  let top = 0
  let bottom = window.innerHeight
  for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const overflow = window.getComputedStyle(ancestor).overflowY
    if (!['auto', 'scroll', 'hidden', 'clip'].includes(overflow)) continue
    const ancestorBounds = ancestor.getBoundingClientRect()
    top = Math.max(top, ancestorBounds.top + ancestor.clientTop)
    bottom = Math.min(bottom, ancestorBounds.top + ancestor.clientTop + ancestor.clientHeight)
  }
  return bounds.top >= top && bounds.top < bottom
}

export function useRevealError(
  targetRef: React.RefObject<HTMLElement | null>,
  rejection: object | number | null | undefined,
  layoutPending = false,
  layoutKey?: string,
) {
  const pendingRef = React.useRef<object | number | null>(null)
  const layoutPendingRef = React.useRef(layoutPending)
  layoutPendingRef.current = layoutPending
  const layoutKeyRef = React.useRef(layoutKey)

  React.useEffect(() => {
    if (layoutKeyRef.current !== layoutKey) pendingRef.current = null
    layoutKeyRef.current = layoutKey
  }, [layoutKey])

  React.useEffect(() => {
    pendingRef.current = null
    if (rejection === null || rejection === undefined) return
    if (layoutPendingRef.current) pendingRef.current = rejection
    let target: HTMLElement | null = null
    const cancelPending = () => { pendingRef.current = null }
    const frame = window.requestAnimationFrame(() => {
      target = targetRef.current
      if (!target?.isConnected) return
      target.addEventListener('blur', cancelPending)
      target.focus({ preventScroll: true })
      target.scrollIntoView?.({ behavior: 'instant', block: 'start', inline: 'nearest' })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      target?.removeEventListener('blur', cancelPending)
      pendingRef.current = null
    }
  }, [rejection, targetRef])

  React.useEffect(() => {
    if (layoutPending || pendingRef.current === null || pendingRef.current !== rejection) return
    const frame = window.requestAnimationFrame(() => {
      const target = targetRef.current
      if (pendingRef.current === rejection && target?.isConnected && document.activeElement === target && !isStartVisible(target)) {
        target.scrollIntoView?.({ behavior: 'instant', block: 'start', inline: 'nearest' })
      }
      pendingRef.current = null
    })
    return () => window.cancelAnimationFrame(frame)
  }, [layoutPending, rejection, targetRef])
}
