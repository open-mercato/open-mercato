"use client"

/**
 * "Pending work" on a record page (spec §6.2: *"Record-page surfaces: every
 * bound entity type gets the injected 'pending work' widget"*).
 *
 * Generic by construction: the record it is about comes from the host page's
 * injection context (`resourceKind` + `resourceId`, which every record-detail
 * page already publishes), never from per-spot configuration. Wiring it into a
 * new detail page is therefore one line in `injection-table.ts`.
 *
 * Two deliberate properties:
 *
 * - **It asks the work inbox, not the tasks table.** The inbox is the merged
 *   projection over every registered source, so a disposition raised by the
 *   enterprise agent bridge shows up here for free, and the query's own tenant/
 *   organization scoping decides what the caller may see.
 * - **`entityType` is matched across spellings.** Bindings are authored free
 *   text (`customers:person`) while `resourceKind` uses dots
 *   (`customers.person`); the filter forwards every known spelling rather than
 *   asking authors to guess which one the widget wants.
 */

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  EntityContextPanel,
  workItemsToEntityContextItems,
} from '../../../components/work-inbox/EntityContextPanel'
import type { PendingWorkItem } from '../../../components/work-inbox/EntityContextPanel'
import { entityTypeQueryValues } from '../../../lib/work-inbox/entity-links'

/** Open statuses only — a record page is about outstanding work, not history. */
const OPEN_STATUSES = 'PENDING,IN_PROGRESS,ESCALATED'

const MAX_ITEMS = 10

export type RecordContext = {
  resourceKind?: string | null
  resourceId?: string | null
}

export type RecordData = {
  id?: string | null
}

type WorkInboxResponse = {
  data: PendingWorkItem[]
}

export function resolvePendingWorkTarget(
  context: RecordContext | null | undefined,
  data: RecordData | null | undefined,
): { entityType: string; entityId: string } | null {
  const entityType = typeof context?.resourceKind === 'string' ? context.resourceKind : null
  const entityId =
    (typeof context?.resourceId === 'string' && context.resourceId) ||
    (typeof data?.id === 'string' && data.id) ||
    null
  if (!entityType || !entityId) return null
  return { entityType, entityId }
}

export function buildPendingWorkQuery(entityType: string): string {
  const params = new URLSearchParams()
  params.set('entityType', entityTypeQueryValues(entityType).join(','))
  params.set('status', OPEN_STATUSES)
  params.set('limit', String(MAX_ITEMS))
  return params.toString()
}

export default function PendingWorkWidget({
  context,
  data,
}: InjectionWidgetComponentProps<RecordContext, RecordData>) {
  const t = useT()
  const target = resolvePendingWorkTarget(context, data)

  const { data: rows, isLoading } = useQuery({
    queryKey: ['workflows-pending-work', target?.entityType, target?.entityId],
    enabled: Boolean(target),
    queryFn: async () => {
      if (!target) return []
      const result = await apiCall<WorkInboxResponse>(
        `/api/workflows/work-inbox?${buildPendingWorkQuery(target.entityType)}`,
      )
      if (!result.ok) return []
      const items = result.result?.data ?? []
      // The inbox filter narrows by entity TYPE; this record is one of them.
      return items.filter((item) =>
        (item as PendingWorkItem & { entityBindings?: Array<{ entityId?: string }> }).entityBindings?.some(
          (binding) => binding.entityId === target.entityId,
        ) ?? false,
      )
    },
  })

  if (!target) return null

  return (
    <EntityContextPanel
      testId="workflows-pending-work"
      title={t('workflows.pendingWork.title')}
      items={workItemsToEntityContextItems(rows, {
        status: (status) => t(`workflows.tasks.statuses.${status}`, status),
        priority: (priority) => t(`workflows.workInbox.priorities.${priority}`, priority),
        overdue: t('workflows.tasks.overdue'),
        due: (formatted) => `${t('workflows.tasks.fields.dueDate')}: ${formatted}`,
      })}
      emptyLabel={t('workflows.pendingWork.empty')}
      linkLabel={t('workflows.pendingWork.open')}
      loading={isLoading}
      loadingLabel={t('workflows.pendingWork.loading')}
    />
  )
}
