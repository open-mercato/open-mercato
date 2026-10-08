import * as React from 'react'
import {
  readJsonFromLocalStorage,
  removeLocalStorageKey,
  writeJsonToLocalStorage,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'

const EXPLAIN_MODE_STORAGE_PREFIX = 'om:insights:explain-mode:'

const explainModeByForm = new Map<string, boolean>()
const explainModeListeners = new Set<() => void>()

function storageKey(formEntityId: string): string {
  return `${EXPLAIN_MODE_STORAGE_PREFIX}${formEntityId}`
}

/** Deliberately a raw boolean flag (no versioned envelope): a single on/off preference per form. */
function readStoredExplainMode(formEntityId: string): boolean {
  return readJsonFromLocalStorage<boolean>(storageKey(formEntityId), false) === true
}

export function readExplainMode(formEntityId: string): boolean {
  const cached = explainModeByForm.get(formEntityId)
  if (cached !== undefined) return cached
  const stored = readStoredExplainMode(formEntityId)
  explainModeByForm.set(formEntityId, stored)
  return stored
}

export function setExplainMode(formEntityId: string, enabled: boolean): void {
  explainModeByForm.set(formEntityId, enabled)
  if (enabled) writeJsonToLocalStorage(storageKey(formEntityId), true)
  else removeLocalStorageKey(storageKey(formEntityId))
  for (const listener of Array.from(explainModeListeners)) listener()
}

export function resetExplainModeState(): void {
  explainModeByForm.clear()
}

function subscribeToExplainMode(listener: () => void): () => void {
  explainModeListeners.add(listener)
  return () => {
    explainModeListeners.delete(listener)
  }
}

function readServerExplainMode(): boolean {
  return false
}

/**
 * Explain mode of one CrudForm (keyed by the entity segment of its spot id), shared by the header
 * switch and every field "Why?" button of that form and remembered per browser.
 */
export function useExplainMode(formEntityId: string | null): [boolean, (enabled: boolean) => void] {
  const readSnapshot = React.useCallback(
    () => (formEntityId ? readExplainMode(formEntityId) : false),
    [formEntityId],
  )
  const enabled = React.useSyncExternalStore(subscribeToExplainMode, readSnapshot, readServerExplainMode)
  const setEnabled = React.useCallback(
    (next: boolean) => {
      if (formEntityId) setExplainMode(formEntityId, next)
    },
    [formEntityId],
  )
  return [enabled, setEnabled]
}
