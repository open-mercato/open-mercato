'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'

/**
 * Persists a boolean flag in localStorage under a given key.
 * Reads once on mount; writes on every change after mount.
 * Designed to back collapse/expand state for crud form groups and zones.
 */
export function usePersistedBooleanFlag(storageKey: string, defaultValue: boolean) {
  const [value, setValue] = useState(defaultValue)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const saved = readJsonFromLocalStorage<string | null>(storageKey, null)
    if (saved !== null) {
      setValue(saved === '1')
    }
  }, [storageKey])

  useEffect(() => {
    if (!mounted.current) return
    writeJsonToLocalStorage(storageKey, value ? '1' : '0')
  }, [storageKey, value])

  const toggle = useCallback(() => {
    setValue((prev) => !prev)
  }, [])

  return { value, toggle, setValue }
}
