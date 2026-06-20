"use client"
import * as React from 'react'

/**
 * In-memory store for the unified record-conflict bar.
 *
 * When a mutation fails with an OSS optimistic-lock conflict (HTTP 409 with
 * `code: 'optimistic_lock_conflict'`), forms surface it through this store so a
 * persistent, error-styled bar — the `RecordConflictBanner` rendered once in
 * `AppShell` — shows the "this record was modified" message app-wide, instead
 * of a transient toast that scrolls away. Mirrors the undo `LastOperationBanner`
 * pattern but for the error case, and is shared by `CrudForm`,
 * `useGuardedMutation`, and any custom page, so every form behaves the same.
 *
 * Unlike the operations store this is NOT persisted to localStorage — it holds
 * a live `onRefresh` callback and a conflict only matters for the current page
 * session.
 */
export type RecordConflictEntry = {
  id: string
  /** Localized, user-facing message (e.g. ui.forms.flash.recordModified). */
  message: string
  /** Optional localized title; the banner falls back to a generic title. */
  title?: string | null
  /** The server's current `updated_at`, for diagnostics / future diffing. */
  currentUpdatedAt?: string | null
  /**
   * Invoked when the user clicks "Refresh". When omitted the banner reloads
   * the page (the safe default — re-fetches the latest server state).
   */
  onRefresh?: (() => void) | null
  createdAt: number
}

let internalEntry: RecordConflictEntry | null = null
let sequence = 0

const emitter = new EventTarget()

function emit(): void {
  emitter.dispatchEvent(new Event('change'))
}

function subscribe(listener: () => void): () => void {
  const wrapped = () => listener()
  emitter.addEventListener('change', wrapped)
  return () => emitter.removeEventListener('change', wrapped)
}

function nextId(): string {
  sequence += 1
  return `conflict:${sequence}`
}

export type ShowRecordConflictInput = {
  message: string
  title?: string | null
  currentUpdatedAt?: string | null
  onRefresh?: (() => void) | null
}

/** Show (or replace) the active record-conflict bar. */
export function showRecordConflict(input: ShowRecordConflictInput): void {
  internalEntry = {
    id: nextId(),
    message: input.message,
    title: input.title ?? null,
    currentUpdatedAt: input.currentUpdatedAt ?? null,
    onRefresh: input.onRefresh ?? null,
    createdAt: typeof Date !== 'undefined' ? Date.now() : 0,
  }
  emit()
}

/** Clear the active record-conflict bar. */
export function dismissRecordConflict(): void {
  if (internalEntry === null) return
  internalEntry = null
  emit()
}

/** Read the active conflict (null when none). Subscribes to changes. */
export function useRecordConflict(): RecordConflictEntry | null {
  return React.useSyncExternalStore(
    subscribe,
    () => internalEntry,
    () => null,
  )
}

/** Test-only accessor for the current entry without React. */
export function getRecordConflictForTest(): RecordConflictEntry | null {
  return internalEntry
}
