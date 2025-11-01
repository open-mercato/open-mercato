"use client"
import * as React from 'react'
import type { OperationMetadataPayload } from '@open-mercato/shared/lib/commands/operationMetadata'

export type OperationEntry = OperationMetadataPayload & {
  receivedAt: number
}

export type UndoneEntry = OperationEntry & {
  undoneAt: number
}

type OperationStoreState = {
  stack: OperationEntry[]
  undone: UndoneEntry[]
}

const DEFAULT_STATE: OperationStoreState = { stack: [], undone: [] }

const STORAGE_KEY = 'om:last-operations:v1'
const STACK_LIMIT = 20
const LAST_OPERATION_TTL_MS = 60_000
const STACK_RETENTION_MS = 10 * 60_000

let internalState: OperationStoreState = DEFAULT_STATE

if (typeof window !== 'undefined') {
  internalState = loadState()
}

const emitter = new EventTarget()

function now() {
  return typeof performance !== 'undefined' && performance.now
    ? Math.round(performance.timeOrigin + performance.now())
    : Date.now()
}

function loadState(): OperationStoreState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STATE
    const stack = Array.isArray(parsed.stack) ? parsed.stack.filter(isValidEntry).map(hydrateEntry) : []
    const undone = Array.isArray(parsed.undone)
      ? parsed.undone.filter(isValidEntry).map((raw: unknown) => {
          const hydrated = hydrateEntry(raw)
          const candidate = raw as { undoneAt?: unknown }
          const undoneAt = typeof candidate.undoneAt === 'number' ? candidate.undoneAt : now()
          return { ...hydrated, undoneAt }
        })
      : []
    return pruneState({ stack, undone })
  } catch {
    return DEFAULT_STATE
  }
}

function isValidEntry(entry: unknown): entry is OperationEntry {
  if (entry == null || typeof entry !== 'object') return false
  const candidate = entry as Record<string, unknown>
  return (
    typeof candidate.id === 'string'
    && typeof candidate.undoToken === 'string'
    && typeof candidate.commandId === 'string'
    && typeof candidate.receivedAt === 'number'
    && typeof candidate.executedAt === 'string'
  )
}

function hydrateEntry(entry: unknown): OperationEntry {
  const source = entry as Partial<OperationEntry> & Record<string, unknown>
  return {
    id: String(source.id),
    undoToken: String(source.undoToken),
    commandId: String(source.commandId),
    actionLabel: typeof source.actionLabel === 'string' ? source.actionLabel : source.actionLabel === null ? null : null,
    resourceKind: typeof source.resourceKind === 'string' ? source.resourceKind : null,
    resourceId: typeof source.resourceId === 'string' ? source.resourceId : null,
    executedAt: typeof source.executedAt === 'string' ? source.executedAt : new Date((source.receivedAt as number | undefined) || now()).toISOString(),
    receivedAt: typeof source.receivedAt === 'number' ? source.receivedAt : now(),
  }
}

function persist(state: OperationStoreState) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore storage quota errors
  }
}

function pruneState(state: OperationStoreState): OperationStoreState {
  const timestamp = now()
  const stack = state.stack
    .filter((entry, index, arr) => {
      // Deduplicate by id/undoToken keeping latest
      const duplicateIndex = arr.findIndex((candidate) => candidate.id === entry.id || candidate.undoToken === entry.undoToken)
      if (duplicateIndex !== index) return false
      return timestamp - entry.receivedAt <= STACK_RETENTION_MS
    })
    .sort((a, b) => a.receivedAt - b.receivedAt)
    .slice(-STACK_LIMIT)
  const undone = state.undone
    .filter((entry) => timestamp - entry.undoneAt <= STACK_RETENTION_MS)
    .sort((a, b) => a.undoneAt - b.undoneAt)
    .slice(-STACK_LIMIT)
  const next = { stack, undone }
  return next
}

function emit() {
  emitter.dispatchEvent(new Event('change'))
}

function updateState(updater: (prev: OperationStoreState) => OperationStoreState) {
  const next = pruneState(updater(internalState))
  internalState = next
  persist(next)
  emit()
}

function subscribe(listener: () => void) {
  const wrapped = () => listener()
  emitter.addEventListener('change', wrapped)
  return () => emitter.removeEventListener('change', wrapped)
}

function getClientSnapshot(): OperationStoreState {
  internalState = pruneState(internalState)
  return internalState
}

export function useOperationStore<T>(selector: (state: OperationStoreState) => T): T {
  return React.useSyncExternalStore(
    subscribe,
    () => selector(getClientSnapshot()),
    () => selector(DEFAULT_STATE),
  )
}

export function pushOperation(meta: OperationMetadataPayload) {
  if (typeof window === 'undefined') return
  updateState((prev) => {
    const entry: OperationEntry = {
      ...meta,
      receivedAt: now(),
    }
    const stack = prev.stack.filter((item) => item.id !== entry.id && item.undoToken !== entry.undoToken)
    stack.push(entry)
    return { stack, undone: [] }
  })
}

export function markUndoSuccess(undoToken: string) {
  if (typeof window === 'undefined') return
  const removed: OperationEntry[] = []
  updateState((prev) => {
    const stack = prev.stack.filter((entry) => {
      if (entry.undoToken === undoToken) {
        removed.push(entry)
        return false
      }
      return true
    })
    const undone = removed.length
      ? [...prev.undone, ...removed.map((entry) => ({ ...entry, undoneAt: now() }))]
      : prev.undone
    return { stack, undone }
  })
}

export function markRedoConsumed(logId: string) {
  if (typeof window === 'undefined') return
  updateState((prev) => ({
    stack: prev.stack,
    undone: prev.undone.filter((entry) => entry.id !== logId),
  }))
}

export function getLastOperation(): OperationEntry | null {
  const state = getClientSnapshot()
  if (!state.stack.length) return null
  const last = state.stack[state.stack.length - 1]
  const lastExecuted = Date.parse(last.executedAt)
  const cutoff = now() - LAST_OPERATION_TTL_MS
  if (Number.isFinite(lastExecuted) && lastExecuted < cutoff) return null
  if (!Number.isFinite(lastExecuted) && last.receivedAt < cutoff) return null
  return last
}

export function useLastOperation(): OperationEntry | null {
  return useOperationStore(getLastOperationFromState)
}

function getLastOperationFromState(state: OperationStoreState): OperationEntry | null {
  if (!state.stack.length) return null
  const last = state.stack[state.stack.length - 1]
  const timestamp = now()
  const executedAt = Date.parse(last.executedAt)
  const cutoff = timestamp - LAST_OPERATION_TTL_MS
  if (Number.isFinite(executedAt)) {
    return executedAt >= cutoff ? last : null
  }
  return last.receivedAt >= cutoff ? last : null
}

export function useRedoCandidate(): UndoneEntry | null {
  return useOperationStore((state) => (state.undone.length ? state.undone[state.undone.length - 1] : null))
}

export function hasRedoCandidate(logId: string): boolean {
  const state = getClientSnapshot()
  if (!state.undone.length) return false
  const top = state.undone[state.undone.length - 1]
  return top.id === logId
}

export function clearAllOperations() {
  if (typeof window === 'undefined') return
  internalState = DEFAULT_STATE
  persist(internalState)
  emit()
}

export const operationStackConstants = {
  LAST_OPERATION_TTL_MS,
}
