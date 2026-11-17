'use client'

import * as React from 'react'

/**
 * Live counts rendered on sidebar nav items ("3 waiting for you").
 *
 * Why this is a client-side store rather than a field on the chrome payload:
 * `/api/auth/admin/nav` is cached for 30 minutes behind a module-surface
 * fingerprint, so a per-user count served through it would be both stale and
 * cache-poisoning. Core owns the capability and the rendering; whichever module
 * owns the number mounts a headless widget into `shell:sidebar:badges` and
 * publishes here.
 *
 * Counts are advisory: a nav item renders exactly what it is given, and an
 * absent or zero count renders nothing at all — never a "0" chip.
 */
export type NavBadgeTone = 'default' | 'attention'

export type NavBadge = {
  count: number
  tone?: NavBadgeTone
  /** Accessible label; falls back to the raw count when omitted. */
  label?: string
}

const badges = new Map<string, NavBadge>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function setNavBadge(href: string, badge: NavBadge | null): void {
  if (!href) return
  if (!badge || !Number.isFinite(badge.count) || badge.count <= 0) {
    if (badges.delete(href)) emit()
    return
  }
  const current = badges.get(href)
  if (current && current.count === badge.count && current.tone === badge.tone && current.label === badge.label) return
  badges.set(href, badge)
  emit()
}

export function clearNavBadge(href: string): void {
  setNavBadge(href, null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useNavBadge(href: string): NavBadge | null {
  const getSnapshot = React.useCallback(() => badges.get(href) ?? null, [href])
  const getServerSnapshot = React.useCallback(() => null, [])
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
