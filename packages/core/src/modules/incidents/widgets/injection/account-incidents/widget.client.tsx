"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type TargetType = 'customer_person' | 'customer_company'

type Target = {
  targetType: TargetType
  targetId: string
}

type HostContext = Record<string, unknown> & {
  personId?: string | null
  companyId?: string | null
  resourceKind?: string | null
  resourceId?: string | null
  recordId?: string | null
  entityId?: string | null
}

type HostData = Record<string, unknown> & {
  id?: string | null
  person?: { id?: string | null } | null
  company?: { id?: string | null } | null
}

type AccountIncidentsWidgetProps = {
  context?: HostContext
  data?: HostData
}

type IncidentByTargetItem = {
  id: string
  number: string | null
  title: string | null
  status: string
  severityId: string | null
  impactStatus: string
}

type IncidentByTargetResponse = {
  items?: IncidentByTargetItem[]
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function pushUniqueTarget(targets: Target[], target: Target): void {
  if (targets.some((entry) => entry.targetType === target.targetType && entry.targetId === target.targetId)) {
    return
  }
  targets.push(target)
}

function resolveTargets(context: HostContext | undefined, data: HostData | undefined): Target[] {
  const resourceKind = readString(context?.resourceKind) ?? readString(context?.entityId)
  const personId =
    readString(context?.personId) ??
    readString(data?.person?.id) ??
    (resourceKind === 'customers.person'
      ? readString(context?.resourceId) ?? readString(context?.recordId) ?? readString(data?.id)
      : null)
  const companyId =
    readString(context?.companyId) ??
    readString(data?.company?.id) ??
    (resourceKind === 'customers.company'
      ? readString(context?.resourceId) ?? readString(context?.recordId) ?? readString(data?.id)
      : null)

  const targets: Target[] = []
  if (personId) pushUniqueTarget(targets, { targetType: 'customer_person', targetId: personId })
  if (companyId) pushUniqueTarget(targets, { targetType: 'customer_company', targetId: companyId })

  if (targets.length === 0) {
    const ambiguousRecordId =
      readString(data?.id) ?? readString(context?.recordId) ?? readString(context?.resourceId)
    if (ambiguousRecordId) {
      pushUniqueTarget(targets, { targetType: 'customer_person', targetId: ambiguousRecordId })
      pushUniqueTarget(targets, { targetType: 'customer_company', targetId: ambiguousRecordId })
    }
  }

  return targets
}

function statusVariant(status: string): StatusBadgeVariant {
  if (status === 'open') return 'error'
  if (status === 'investigating' || status === 'identified') return 'warning'
  if (status === 'mitigated') return 'info'
  if (status === 'resolved') return 'success'
  return 'neutral'
}

function statusLabel(t: ReturnType<typeof useT>, status: string): string {
  if (status === 'open') return t('incidents.incident.status.open')
  if (status === 'investigating') return t('incidents.incident.status.investigating')
  if (status === 'identified') return t('incidents.incident.status.identified')
  if (status === 'mitigated') return t('incidents.incident.status.mitigated')
  if (status === 'resolved') return t('incidents.incident.status.resolved')
  if (status === 'closed') return t('incidents.incident.status.closed')
  return status || t('incidents.incident.status.unknown')
}

function isIncidentItem(value: unknown): value is IncidentByTargetItem {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.status === 'string'
}

async function loadIncidents(targets: Target[]): Promise<IncidentByTargetItem[]> {
  const results = await Promise.all(
    targets.map(async (target) => {
      const params = new URLSearchParams({
        targetType: target.targetType,
        targetId: target.targetId,
      })
      const result = await apiCall<IncidentByTargetResponse>(`/api/incidents/by-target?${params.toString()}`)
      if (!result.ok) return []
      const items = Array.isArray(result.result?.items) ? result.result.items : []
      return items.filter(isIncidentItem)
    }),
  )

  const byId = new Map<string, IncidentByTargetItem>()
  for (const item of results.flat()) {
    byId.set(item.id, item)
  }
  return Array.from(byId.values())
}

export default function AccountIncidentsWidget({ context, data }: AccountIncidentsWidgetProps) {
  const t = useT()
  const targets = React.useMemo(() => resolveTargets(context, data), [context, data])
  const targetKey = React.useMemo(
    () => targets.map((target) => `${target.targetType}:${target.targetId}`).join('|'),
    [targets],
  )

  const query = useQuery({
    queryKey: ['incidents-account-incidents', targetKey],
    queryFn: () => loadIncidents(targets),
    enabled: targets.length > 0,
  })

  const items = query.data ?? []
  if (targets.length === 0 || query.isLoading || query.isError || items.length === 0) {
    return null
  }

  return (
    <section className="rounded-md border border-border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-status-warning-icon" aria-hidden="true" />
          <h3 className="text-sm font-semibold">
            {t('incidents.widgets.accountIncidents.title', 'Account incidents')}
          </h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {t(
            'incidents.widgets.accountIncidents.affectingCount',
            '{count} incident(s) affecting this account',
            { count: items.length },
          )}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const number = item.number?.trim() || t('incidents.incident.list.unnumbered', 'Unnumbered')
          const title = item.title?.trim() || t('incidents.incident.detail.untitled', 'Untitled incident')
          return (
            <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
              <Link
                href={`/backend/incidents/${item.id}`}
                className="min-w-0 flex-1 font-medium text-primary hover:underline"
                aria-label={t(
                  'incidents.widgets.accountIncidents.viewIncident',
                  'View incident {number}',
                  { number },
                )}
              >
                <span className="break-words">#{number} {title}</span>
              </Link>
              <StatusBadge variant={statusVariant(item.status)} dot>
                {statusLabel(t, item.status)}
              </StatusBadge>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
