"use client"
import * as React from 'react'

export type PartialIndexNotice = {
  entity: string
  entityLabel: string
  baseCount: number | null
  indexedCount: number | null
  scope: 'scoped' | 'global'
  receivedAt: number
}

type PartialIndexInput = {
  entity: string
  entityLabel?: string
  baseCount?: number | null
  indexedCount?: number | null
  scope?: 'scoped' | 'global'
}

const TTL_MS = 120_000

let current: PartialIndexNotice | null = null
const emitter = new EventTarget()

function now(): number {
  return typeof performance !== 'undefined' && performance.now
    ? Math.round(performance.timeOrigin + performance.now())
    : Date.now()
}

function subscribe(listener: () => void) {
  const wrapped = () => listener()
  emitter.addEventListener('change', wrapped)
  return () => emitter.removeEventListener('change', wrapped)
}

function emit() {
  emitter.dispatchEvent(new Event('change'))
}

function normalizeInput(input: PartialIndexInput): PartialIndexNotice {
  const label = typeof input.entityLabel === 'string' && input.entityLabel.trim()
    ? input.entityLabel.trim()
    : input.entity
  return {
    entity: input.entity,
    entityLabel: label,
    baseCount: typeof input.baseCount === 'number' ? input.baseCount : null,
    indexedCount: typeof input.indexedCount === 'number' ? input.indexedCount : null,
    scope: input.scope === 'global' ? 'global' : 'scoped',
    receivedAt: now(),
  }
}

function prune(stale: PartialIndexNotice | null): PartialIndexNotice | null {
  if (!stale) return null
  const age = now() - stale.receivedAt
  if (!Number.isFinite(age) || age > TTL_MS) return null
  return stale
}

function getSnapshot(): PartialIndexNotice | null {
  current = prune(current)
  return current
}

export function usePartialIndexWarning(): PartialIndexNotice | null {
  return React.useSyncExternalStore(
    subscribe,
    () => getSnapshot(),
    () => null,
  )
}

export function pushPartialIndexWarning(input: PartialIndexInput) {
  if (typeof window === 'undefined') return
  if (!input.entity) return
  const next = normalizeInput(input)
  current = next
  emit()
}

export function dismissPartialIndexWarning() {
  if (typeof window === 'undefined') return
  current = null
  emit()
}
