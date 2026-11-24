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

function scrollToStart(target: HTMLElement) {
  target.scrollIntoView?.({ behavior: 'instant', block: 'start', inline: 'nearest' })
}

function revealIfDisplaced(target: HTMLElement | null) {
  if (target?.isConnected && document.activeElement === target && !isStartVisible(target)) scrollToStart(target)
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
  const observerRef = React.useRef<ResizeObserver | null>(null)
  const cancelPending = React.useCallback(() => {
    pendingRef.current = null
    observerRef.current?.disconnect()
    observerRef.current = null
  }, [])
  React.useEffect(() => {
    if (layoutKeyRef.current !== layoutKey) cancelPending()
    layoutKeyRef.current = layoutKey
  }, [cancelPending, layoutKey])
  React.useEffect(() => {
    if (rejection === null || rejection === undefined) return
    if (layoutPendingRef.current) pendingRef.current = rejection
    let target: HTMLElement | null = null
    const frame = window.requestAnimationFrame(() => {
      target = targetRef.current
      if (!target?.isConnected) return
      target.addEventListener('blur', cancelPending)
      target.focus({ preventScroll: true })
      scrollToStart(target)
      const form = layoutKeyRef.current !== undefined ? target.closest('form') : null
      if (!form || typeof ResizeObserver === 'undefined') return
      const observer = new ResizeObserver(() => {
        if (observerRef.current === observer) revealIfDisplaced(target)
      })
      observerRef.current = observer
      observer.observe(form, { box: 'border-box' })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      target?.removeEventListener('blur', cancelPending)
      cancelPending()
    }
  }, [cancelPending, rejection, targetRef])

  React.useEffect(() => {
    if (layoutPending || pendingRef.current === null || pendingRef.current !== rejection) return
    const frame = window.requestAnimationFrame(() => {
      if (pendingRef.current === rejection) revealIfDisplaced(targetRef.current)
      pendingRef.current = null
    })
    return () => window.cancelAnimationFrame(frame)
  }, [layoutPending, rejection, targetRef])
}
