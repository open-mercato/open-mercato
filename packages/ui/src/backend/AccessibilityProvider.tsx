'use client'

import * as React from 'react'
import { readApiResultOrThrow } from './utils/apiCall'
import {
  ACCESSIBILITY_PREFERENCES_CHANGED_EVENT,
  applyAccessibilityPreferences,
} from './accessibility'
import type { AccessibilityPreferences } from '@open-mercato/core/modules/auth/data/validators'

type ProfileAccessibilityResponse = {
  accessibilityPreferences?: AccessibilityPreferences | null
}

export type AccessibilityStoreState = {
  preferences: AccessibilityPreferences | null
  loading: boolean
  error: unknown
}

const INITIAL_STATE: AccessibilityStoreState = {
  preferences: null,
  loading: true,
  error: null,
}

let state: AccessibilityStoreState = INITIAL_STATE
let loadPromise: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function setState(next: Partial<AccessibilityStoreState>): void {
  state = { ...state, ...next }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): AccessibilityStoreState {
  return state
}

export function __resetAccessibilityStoreForTests(): void {
  state = { ...INITIAL_STATE }
  loadPromise = null
  listeners.clear()
}

function ensureAccessibilityPreferencesLoaded(): Promise<void> {
  if (loadPromise) return loadPromise
  setState({ loading: true, error: null })
  loadPromise = readApiResultOrThrow<ProfileAccessibilityResponse>('/api/auth/profile')
    .then((result) => {
      const prefs = result.accessibilityPreferences ?? null
      setState({ preferences: prefs, loading: false, error: null })
      applyAccessibilityPreferences(prefs)
    })
    .catch((err) => {
      // 401/403 expected on unauthenticated SSR hydration — keep defaults, do not surface loudly
      setState({ loading: false, error: err })
    })
  return loadPromise
}

export function useAccessibilityPreferences(): AccessibilityStoreState {
  React.useEffect(() => {
    void ensureAccessibilityPreferencesLoaded()
  }, [])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function AccessibilityProvider() {
  React.useEffect(() => {
    void ensureAccessibilityPreferencesLoaded()

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<AccessibilityPreferences | null>
      const prefs = customEvent.detail ?? null
      setState({ preferences: prefs })
      applyAccessibilityPreferences(prefs)
    }

    window.addEventListener(ACCESSIBILITY_PREFERENCES_CHANGED_EVENT, handler as EventListener)

    return () => {
      window.removeEventListener(ACCESSIBILITY_PREFERENCES_CHANGED_EVENT, handler as EventListener)
    }
  }, [])

  return null
}
