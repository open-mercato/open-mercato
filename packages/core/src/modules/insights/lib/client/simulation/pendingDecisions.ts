"use client"

import * as React from 'react'

/**
 * Where the run whose decision a form save records comes from: a run completed in this form
 * session through "Simulate impact" (`dialog`), or the run of the result page's apply link
 * (`?simulationRunId=`, `link`). A dialog run wins over a link run.
 */
export type PendingSimulationSource = 'dialog' | 'link'

export type PendingSimulationDecision = {
  runId: string
  recordId: string | null
  source: PendingSimulationSource
}

type FormEntry = Partial<Record<PendingSimulationSource, PendingSimulationDecision>>

const entries = new Map<string, FormEntry>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of Array.from(listeners)) listener()
}

function matches(entry: PendingSimulationDecision | undefined, recordId: string | null): entry is PendingSimulationDecision {
  return entry !== undefined && entry.recordId === recordId
}

export function rememberPendingSimulationRun(formId: string, decision: PendingSimulationDecision): void {
  const current = entries.get(formId) ?? {}
  const existing = current[decision.source]
  if (existing && existing.runId === decision.runId && existing.recordId === decision.recordId) return
  entries.set(formId, { ...current, [decision.source]: decision })
  notify()
}

/** Drops the entry of `source` (only when it still holds `runId`, if given). */
export function forgetPendingSimulationRun(formId: string, source: PendingSimulationSource, runId?: string): void {
  const current = entries.get(formId)
  const existing = current?.[source]
  if (!current || !existing) return
  if (runId !== undefined && existing.runId !== runId) return
  const next: FormEntry = { ...current }
  delete next[source]
  if (next.dialog || next.link) entries.set(formId, next)
  else entries.delete(formId)
  notify()
}

/** The run a save of this form records the decision for (`recordId` must match the form's record). */
export function readPendingSimulationDecision(formId: string | null, recordId: string | null): PendingSimulationDecision | null {
  if (!formId) return null
  const current = entries.get(formId)
  if (!current) return null
  if (matches(current.dialog, recordId)) return current.dialog
  if (matches(current.link, recordId)) return current.link
  return null
}

/** Reads the decision target and clears every entry of the form (a save records one decision). */
export function takePendingSimulationDecision(formId: string | null, recordId: string | null): PendingSimulationDecision | null {
  const decision = readPendingSimulationDecision(formId, recordId)
  if (formId && entries.delete(formId)) notify()
  return decision
}

export function subscribePendingSimulationRuns(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetPendingSimulationRuns(): void {
  entries.clear()
  notify()
}

export function usePendingSimulationDecision(formId: string | null, recordId: string | null): PendingSimulationDecision | null {
  const getSnapshot = React.useCallback(() => readPendingSimulationDecision(formId, recordId), [formId, recordId])
  return React.useSyncExternalStore(subscribePendingSimulationRuns, getSnapshot, () => null)
}
