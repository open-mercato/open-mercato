'use client'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'

const LOCAL_BROADCAST_EVENT = 'om:persisted-boolean-flag:change'

type SafeEventTarget = {
  addEventListener: EventTarget['addEventListener']
  removeEventListener: EventTarget['removeEventListener']
  dispatchEvent: EventTarget['dispatchEvent']
}

const localEmitter: SafeEventTarget | null =
  typeof window !== 'undefined' ? new EventTarget() : null

function readCurrentValue(storageKey: string, defaultValue: boolean): boolean {
  const saved = readJsonFromLocalStorage<string | null>(storageKey, null)
  if (saved === '1') return true
  if (saved === '0') return false
  return defaultValue
}

function persistValue(storageKey: string, next: boolean): void {
  writeJsonToLocalStorage(storageKey, next ? '1' : '0')
  localEmitter?.dispatchEvent(
    new CustomEvent(LOCAL_BROADCAST_EVENT, { detail: storageKey }),
  )
}

function subscribe(storageKey: string, onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const handleStorage = (event: StorageEvent) => {
    if (event.key === storageKey) onChange()
  }
  const handleLocal = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail
    if (detail === storageKey) onChange()
  }

  window.addEventListener('storage', handleStorage)
  localEmitter?.addEventListener(LOCAL_BROADCAST_EVENT, handleLocal)

  return () => {
    window.removeEventListener('storage', handleStorage)
    localEmitter?.removeEventListener(LOCAL_BROADCAST_EVENT, handleLocal)
  }
}

export function usePersistedBooleanFlag(storageKey: string, defaultValue: boolean) {
  const [isHydrated, setIsHydrated] = useState(false)
  const getSnapshot = useCallback(
    () => readCurrentValue(storageKey, defaultValue),
    [storageKey, defaultValue],
  )
  const getServerSnapshot = useCallback(() => defaultValue, [defaultValue])
  const subscribeKey = useCallback(
    (onChange: () => void) => subscribe(storageKey, onChange),
    [storageKey],
  )

  const value = useSyncExternalStore(subscribeKey, getSnapshot, getServerSnapshot)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  const setValue = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const current = readCurrentValue(storageKey, defaultValue)
      const nextValue =
        typeof next === 'function'
          ? (next as (prev: boolean) => boolean)(current)
          : next
      persistValue(storageKey, nextValue)
    },
    [storageKey, defaultValue],
  )

  const toggle = useCallback(() => {
    const current = readCurrentValue(storageKey, defaultValue)
    persistValue(storageKey, !current)
  }, [storageKey, defaultValue])

  return { value, toggle, setValue, isHydrated }
}
