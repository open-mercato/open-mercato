/**
 * Workflows Module - shared ledger-entry presentation helpers (spec
 * 2026-07-26-workflows-ux-redesign.md sections 3.5 / 5).
 *
 * The variable picker popover and the Input data panel list the SAME ledger:
 * entries grouped by producer kind in a fixed reading order, each with a
 * truncated sample snippet. Pure — no React, no DOM — so both surfaces stay in
 * sync and the grouping/formatting rules are unit-testable on their own.
 */

import type { LedgerEntry, LedgerSourceKind } from './context-ledger'

/** Producer groups, ordered from "closest to the author's intent" outward. */
export const LEDGER_GROUP_ORDER: ReadonlyArray<LedgerSourceKind> = [
  'contextSchema',
  'trigger',
  'userTask',
  'activity',
  'setVariable',
  'asyncResult',
  'invokeAgent',
  'signal',
  'join',
  'subWorkflow',
]

export const LEDGER_SAMPLE_MAX_LENGTH = 40

export interface FormattedLedgerSample {
  text: string
  numeric: boolean
}

export interface LedgerEntryGroup {
  kind: LedgerSourceKind
  entries: LedgerEntry[]
}

export function formatLedgerSample(sample: unknown): FormattedLedgerSample | null {
  if (sample === undefined) return null
  const numeric = typeof sample === 'number'
  let text: string
  if (typeof sample === 'string') {
    text = sample
  } else {
    try {
      text = JSON.stringify(sample) ?? String(sample)
    } catch {
      text = String(sample)
    }
  }
  if (text.length > LEDGER_SAMPLE_MAX_LENGTH) {
    text = `${text.slice(0, LEDGER_SAMPLE_MAX_LENGTH - 1)}…`
  }
  return { text, numeric }
}

export function groupLedgerEntries(entries: LedgerEntry[]): LedgerEntryGroup[] {
  const byKind = new Map<LedgerSourceKind, LedgerEntry[]>()
  for (const entry of entries) {
    const list = byKind.get(entry.source.kind) ?? []
    list.push(entry)
    byKind.set(entry.source.kind, list)
  }
  const groups: LedgerEntryGroup[] = []
  for (const kind of LEDGER_GROUP_ORDER) {
    const list = byKind.get(kind)
    if (list && list.length > 0) groups.push({ kind, entries: list })
  }
  return groups
}

/**
 * The `'*'` wildcard entries are unnamed whole-payload spreads: there is no
 * path to insert, so no listing offers them.
 */
export function insertableLedgerEntries(entries: ReadonlyArray<LedgerEntry> | undefined): LedgerEntry[] {
  return (entries ?? []).filter((entry) => entry.path !== '*')
}

export function readLedgerSampleAtPath(data: unknown, path: string): unknown {
  const segments = path.split('.').filter((segment) => segment.length > 0)
  let cursor: unknown = data
  for (const segment of segments) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}
