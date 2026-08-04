"use client"

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

export type SimilarIncident = {
  id: string
  number: string
  title: string
  status: string
}

type SimilarIncidentsCardProps = {
  title?: string | null
  currentIncidentId?: string | null
  providedIncidents?: readonly SimilarIncident[]
  compact?: boolean
  debounceMs?: number
}

type SearchPresenter = {
  title?: string
  subtitle?: string
}

type SearchResult = {
  entityId?: string
  recordId?: string
  presenter?: SearchPresenter | null
  metadata?: Record<string, unknown> | null
}

type SearchResponse = {
  results?: SearchResult[]
}

type IncidentRecord = {
  id?: string | null
  number?: string | null
  title?: string | null
  status?: string | null
}

type IncidentsResponse = {
  items?: IncidentRecord[]
}

function statusVariant(status: string | null | undefined): StatusBadgeVariant {
  if (status === 'open') return 'error'
  if (status === 'investigating' || status === 'identified') return 'warning'
  if (status === 'mitigated') return 'info'
  if (status === 'resolved') return 'success'
  if (status === 'closed') return 'neutral'
  return 'neutral'
}

function statusLabel(t: ReturnType<typeof useT>, status: string | null | undefined): string {
  if (status === 'open') return t('incidents.incident.status.open')
  if (status === 'investigating') return t('incidents.incident.status.investigating')
  if (status === 'identified') return t('incidents.incident.status.identified')
  if (status === 'mitigated') return t('incidents.incident.status.mitigated')
  if (status === 'resolved') return t('incidents.incident.status.resolved')
  if (status === 'closed') return t('incidents.incident.status.closed')
  return t('incidents.similar.status.unknown', 'Unknown')
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeProvidedIncident(item: SimilarIncident): SimilarIncident | null {
  const id = readString(item.id)
  if (!id) return null
  return {
    id,
    number: readString(item.number) ?? id,
    title: readString(item.title) ?? id,
    status: readString(item.status) ?? 'unknown',
  }
}

function normalizeSearchResult(result: SearchResult): SimilarIncident | null {
  if (result.entityId !== 'incidents:incident') return null
  const id = readString(result.recordId)
  if (!id) return null
  const metadataStatus = result.metadata?.status
  return {
    id,
    number: readString(result.presenter?.subtitle) ?? id,
    title: readString(result.presenter?.title) ?? id,
    status: readString(metadataStatus) ?? 'unknown',
  }
}

function mergeHydratedResults(base: SimilarIncident[], hydrated: readonly IncidentRecord[]): SimilarIncident[] {
  const byId = new Map<string, IncidentRecord>()
  hydrated.forEach((item) => {
    const id = readString(item.id)
    if (id) byId.set(id, item)
  })
  return base.map((item) => {
    const record = byId.get(item.id)
    if (!record) return item
    return {
      id: item.id,
      number: readString(record.number) ?? item.number,
      title: readString(record.title) ?? item.title,
      status: readString(record.status) ?? item.status,
    }
  })
}

async function searchSimilarIncidents(query: string, currentIncidentId: string | null | undefined): Promise<SimilarIncident[]> {
  const params = new URLSearchParams()
  params.set('q', query)
  params.set('limit', '5')
  params.set('entityTypes', 'incidents:incident')
  const call = await apiCall<SearchResponse>(`/api/search/search?${params.toString()}`)
  if (!call.ok || !call.result) return []
  const incidents = (call.result.results ?? [])
    .map(normalizeSearchResult)
    .filter((item): item is SimilarIncident => item !== null && item.id !== currentIncidentId)
    .slice(0, 5)
  if (!incidents.length) return []
  const ids = incidents.map((item) => item.id).join(',')
  const hydrated = await apiCall<IncidentsResponse>(
    `/api/incidents?ids=${encodeURIComponent(ids)}&page=1&pageSize=5`,
    undefined,
    { fallback: { items: [] } },
  )
  return mergeHydratedResults(incidents, hydrated.result?.items ?? [])
}

export function SimilarIncidentsCard({
  title,
  currentIncidentId,
  providedIncidents,
  compact = false,
  debounceMs = 500,
}: SimilarIncidentsCardProps) {
  const t = useT()
  const [items, setItems] = React.useState<SimilarIncident[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (providedIncidents) {
      setItems(providedIncidents.map(normalizeProvidedIncident).filter((item): item is SimilarIncident => item !== null))
    }
  }, [providedIncidents])

  React.useEffect(() => {
    if (providedIncidents) return
    const query = title?.trim() ?? ''
    if (query.length < 3) {
      setItems([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      searchSimilarIncidents(query, currentIncidentId)
        .then((results) => {
          if (!cancelled) setItems(results)
        })
        .catch(() => {
          if (!cancelled) setItems([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, debounceMs)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [currentIncidentId, debounceMs, providedIncidents, title])

  if (!loading && items.length === 0) return null

  return (
    <section className={compact ? 'rounded-md border border-border bg-background p-3' : 'rounded-lg border border-border bg-card p-4'}>
      <SectionHeader title={t('incidents.similar.title', 'Possible duplicates')} />
      <p className="mt-1 text-xs text-muted-foreground">
        {t('incidents.similar.description', 'Searches incident history for related records.')}
      </p>
      <div className="mt-3">
        {loading ? (
          <EmptyState
            variant="subtle"
            icon={<Search className="size-6" aria-hidden="true" />}
            title={t('incidents.similar.loading', 'Searching similar incidents')}
          />
        ) : (
          <ul className="space-y-2">
            {items.slice(0, 5).map((item) => {
              const href = `/backend/incidents/${encodeURIComponent(item.id)}`
              return (
                <li key={item.id} className="rounded-md border border-border bg-background p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="shrink-0 text-xs font-medium text-muted-foreground" title={item.number}>
                          {item.number}
                        </span>
                        <StatusBadge variant={statusVariant(item.status)} dot>
                          {statusLabel(t, item.status)}
                        </StatusBadge>
                      </div>
                      <p className="truncate text-sm font-medium text-foreground" title={item.title}>
                        {item.title}
                      </p>
                    </div>
                    <Button asChild type="button" variant="outline" size="sm" className="whitespace-nowrap">
                      <Link href={href}>
                        <AlertTriangle className="size-4" aria-hidden="true" />
                        {t('incidents.similar.open', 'Open')}
                      </Link>
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
