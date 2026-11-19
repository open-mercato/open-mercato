"use client"

/**
 * The panel that ties work and records together — ONE component, two surfaces.
 *
 * - **Task detail, right column** (spec §6.2: *"right — bound entity card(s)
 *   with deep links"*) renders the records a task is about.
 * - **Record pages** (spec §6.2: *"every bound entity type gets the injected
 *   'pending work' widget"*) render the open work about a record.
 *
 * Both are a titled frame around a list of linked items with an empty state, so
 * the frame, the row, the deep-link degradation and the empty copy are written
 * once here and the two surfaces differ only in the pure mapper that produces
 * the items. The portal task page (Phase 4b) is the third caller by
 * construction rather than by a third copy.
 *
 * Deep links DEGRADE rather than guess: a binding with no id, or one whose
 * record type has no enumerated detail page, renders as a labelled row that
 * says so. Sending an operator to the wrong record is worse than not offering
 * the link.
 */

import * as React from 'react'
import Link from 'next/link'
import { StatusChip } from './StatusChip'
import { buildEntityRecordHref } from '../../lib/work-inbox/entity-links'
import { flattenTaskText } from '../../lib/task-resolution'
import {
  WORK_INBOX_OVERDUE_TONE,
  describeWorkInboxPriority,
  describeWorkInboxStatus,
} from '../../lib/work-inbox/presentation'
import type { WorkInboxStatusDescriptor } from '../../lib/work-inbox/presentation'
import { normalizeWorkInboxPriority } from '../../lib/work-inbox/provider'
import type { UserTaskEntityBinding } from '../../data/types'

export type EntityContextChip = {
  descriptor: WorkInboxStatusDescriptor
  label: string
}

export type EntityContextItem = {
  id: string
  title: string
  /** Machine-ish second line: the record type, the due date, the work kind. */
  subtitle?: string | null
  href?: string | null
  /** Shown in place of the link when there is nowhere to go. */
  noLinkLabel?: string
  chips?: EntityContextChip[]
}

export type EntityContextPanelProps = {
  title: string
  items: EntityContextItem[]
  emptyLabel: string
  linkLabel: string
  /** Rendered while the caller is still fetching; keeps the frame in place. */
  loading?: boolean
  loadingLabel?: string
  testId?: string
}

export function EntityContextPanel({
  title,
  items,
  emptyLabel,
  linkLabel,
  loading,
  loadingLabel,
  testId,
}: EntityContextPanelProps) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-3" data-testid={testId}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {loading ? (
        <p className="text-xs text-muted-foreground">{loadingLabel ?? emptyLabel}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-border p-2 space-y-1">
              <div className="text-sm font-medium text-foreground">{item.title}</div>
              {item.subtitle ? (
                <div className="text-xs text-muted-foreground font-mono">{item.subtitle}</div>
              ) : null}
              {item.chips?.length ? (
                <div className="flex flex-wrap gap-1">
                  {item.chips.map((chip, index) => (
                    <StatusChip key={`${item.id}-chip-${index}`} descriptor={chip.descriptor} label={chip.label} />
                  ))}
                </div>
              ) : null}
              {item.href ? (
                <Link href={item.href} className="text-xs text-primary hover:underline">
                  {linkLabel}
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">{item.noLinkLabel ?? ''}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Task bindings → panel items (task detail, right column).
 *
 * A binding whose id never resolved at creation time is already dropped by
 * `resolveTaskEntityBindings`; one that survives but points at a record type
 * with no detail page still renders, without a link.
 */
export function bindingsToEntityContextItems(
  bindings: UserTaskEntityBinding[] | null | undefined,
  labels: { noLink: string },
): EntityContextItem[] {
  if (!bindings?.length) return []
  return bindings.map((binding, index) => ({
    id: `${binding.entityType}:${binding.entityId}:${index}`,
    title: flattenTaskText(binding.label ?? null) ?? binding.entityType,
    subtitle: binding.entityType,
    href: buildEntityRecordHref(binding.entityType, binding.entityId),
    noLinkLabel: labels.noLink,
  }))
}

export type PendingWorkItem = {
  id: string
  title: string
  status: string
  priority: unknown
  dueDate: string | null
  overdue: boolean
  detailHref: string | null
}

/**
 * Work-inbox rows → panel items (record pages).
 *
 * Every chip pairs a design-system token with its own icon and a translated
 * label, so status is never colour-only here either.
 */
export function workItemsToEntityContextItems(
  rows: PendingWorkItem[] | null | undefined,
  labels: {
    status: (status: string) => string
    priority: (priority: string) => string
    overdue: string
    due: (formatted: string) => string
  },
): EntityContextItem[] {
  if (!rows?.length) return []
  return rows.map((row) => {
    const chips: EntityContextChip[] = [
      { descriptor: describeWorkInboxStatus(row.status), label: labels.status(row.status) },
    ]
    const priority = normalizeWorkInboxPriority(row.priority)
    const priorityDescriptor = describeWorkInboxPriority(priority)
    if (priority && priorityDescriptor) {
      chips.push({ descriptor: priorityDescriptor, label: labels.priority(priority) })
    }
    if (row.overdue) {
      chips.push({ descriptor: WORK_INBOX_OVERDUE_TONE, label: labels.overdue })
    }
    return {
      id: row.id,
      title: row.title,
      subtitle: row.dueDate ? labels.due(new Date(row.dueDate).toLocaleString()) : null,
      href: row.detailHref,
      chips,
    }
  })
}

export default EntityContextPanel
