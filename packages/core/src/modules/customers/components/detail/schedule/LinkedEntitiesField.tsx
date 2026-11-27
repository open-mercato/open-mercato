'use client'

import * as React from 'react'
import { FileText, Search, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasMoreFromPage } from '@open-mercato/shared/lib/pagination/load-more'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { extensionPoints } from '@open-mercato/core/modules/customers/extension-points'
import { resolveScheduleLinkTypes, type ScheduleLinkTypeDefinition } from './linkTypes'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible, getFieldLabel } from './fieldConfig'
import type { LinkedEntity } from './useScheduleFormState'

const PAGE_SIZE = 20

function LinkTypeIcon({ definition, className }: { definition?: ScheduleLinkTypeDefinition; className: string }) {
  const Icon = definition?.icon ?? FileText
  return <Icon className={className} />
}

function EntityLinkSearchPopover({
  existingIds,
  linkTypes,
  onAdd,
  onAddMany,
  t,
}: {
  existingIds: Set<string>
  linkTypes: readonly ScheduleLinkTypeDefinition[]
  onAdd: (entity: LinkedEntity) => void
  onAddMany: (entities: LinkedEntity[]) => void
  t: (key: string, fallback: string) => string
}) {
  const [open, setOpen] = React.useState(false)
  const [selectedTypeId, setSelectedTypeId] = React.useState('company')
  const linkType = linkTypes.find((definition) => definition.id === selectedTypeId) ?? linkTypes[0]!
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Array<{ id: string; label: string }>>([])
  const [page, setPage] = React.useState(1)
  // Short-page termination instead of a `total`/`totalPages` bound — see
  // `hasMoreFromPage`. `items` is the raw response, before the mapping and
  // filtering below, so its length is what the server served.
  const [hasMore, setHasMore] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const selectableResults = React.useMemo(
    () => results.filter((result) => !existingIds.has(result.id)),
    [existingIds, results],
  )

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    const endpoint = linkType.buildSearchUrl({ page, pageSize: PAGE_SIZE, query })
    readApiResultOrThrow<{ items?: Array<Record<string, unknown>>; totalPages?: number; page?: number; pageSize?: number; total?: number }>(endpoint, { signal: controller.signal })
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : []
        const nextResults = items.map((item) => ({
          id: typeof item?.id === 'string' ? item.id : '',
          label: linkType.resolveLabel(item),
        })).filter((r) => r.id)
        setResults((current) => {
          if (page <= 1) return nextResults
          const merged = new Map(current.map((entry) => [entry.id, entry]))
          nextResults.forEach((entry) => merged.set(entry.id, entry))
          return Array.from(merged.values())
        })
        setHasMore(hasMoreFromPage(items.length, PAGE_SIZE))
      })
      .catch(() => {
        setResults([])
        setHasMore(false)
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [open, page, query, linkType])

  React.useEffect(() => {
    if (!open) return
    setPage(1)
  }, [open, query, linkType])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
          <span className="text-sm">+</span>
          {t('customers.schedule.addLink', 'Add link')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="flex gap-1 mb-2">
          {linkTypes.map((type) => (
            <Button
              key={type.id}
              data-schedule-link-type={type.id}
              type="button"
              variant={linkType.id === type.id ? 'default' : 'ghost'}
              size="sm"
              className="h-6 text-xs flex-1"
              onClick={() => { setSelectedTypeId(type.id); setPage(1); setQuery('') }}
            >
              <LinkTypeIcon definition={type} className="mr-1 size-3" />
              {t(type.labelKey, type.label)}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 mb-2">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('customers.schedule.searchEntity', 'Search...')}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            autoFocus
          />
        </div>
        {selectableResults.length ? (
          <div className="mb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                onAddMany(
                  selectableResults.map((result) => ({
                    id: result.id,
                    type: linkType.id,
                    label: result.label,
                  })),
                )
                setOpen(false)
                setQuery('')
              }}
            >
              {t('customers.schedule.addVisibleLinks', 'Add all visible')}
            </Button>
          </div>
        ) : null}
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {loading && <p className="px-2 py-3 text-xs text-muted-foreground text-center">{t('customers.schedule.searching', 'Searching...')}</p>}
          {!loading && results.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground text-center">{t('customers.schedule.noResults', 'No results')}</p>}
          {results.map((r) => {
            const alreadyLinked = existingIds.has(r.id)
            return (
              <Button
                key={r.id}
                type="button"
                variant="ghost"
                size="sm"
                disabled={alreadyLinked}
                onClick={() => {
                  onAdd({ id: r.id, type: linkType.id, label: r.label })
                  setOpen(false)
                  setQuery('')
                }}
                className={cn(
                  'h-auto flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  alreadyLinked ? 'opacity-40 cursor-default' : 'hover:bg-accent cursor-pointer',
                )}
              >
                <LinkTypeIcon definition={linkType} className="size-3.5 text-muted-foreground shrink-0" />
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
              </Button>
            )
          })}
          {!loading && hasMore ? (
            <div className="px-2 py-2">
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setPage((current) => current + 1)}>
                {t('customers.schedule.loadMore', 'Load more')}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface LinkedEntitiesFieldProps {
  visible: Set<ScheduleFieldId>
  activityType: ActivityType
  linkedEntities: LinkedEntity[]
  setLinkedEntities: React.Dispatch<React.SetStateAction<LinkedEntity[]>>
}

export function LinkedEntitiesField({
  visible,
  activityType,
  linkedEntities,
  setLinkedEntities,
}: LinkedEntitiesFieldProps) {
  const t = useT()
  const { widgets, loading } = useInjectionWidgets(extensionPoints.hosts.scheduleLinkTypes.spotId)
  const linkTypes = React.useMemo(() => resolveScheduleLinkTypes(widgets.map((widget) => widget.module)), [widgets])

  if (!isVisible(activityType, 'linkedEntities')) return null

  const sectionLabel = getFieldLabel(
    activityType,
    'linkedEntities',
    t,
    'customers.schedule.linkedEntities',
    'Linked entities',
  )

  return (
    <div data-schedule-link-types-loading={loading ? 'true' : 'false'}>
      <label className="text-overline font-semibold uppercase text-muted-foreground tracking-wider">
        {sectionLabel}
      </label>
      <div className="mt-2.5 flex flex-wrap content-center items-center gap-2">
        {linkedEntities.map((entity) => (
          <div
            key={entity.id}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs',
              entity.type === 'deal'
                ? 'border-status-success-border bg-status-success-bg font-semibold text-foreground'
                : 'border-border bg-muted text-foreground',
            )}
          >
            <LinkTypeIcon definition={linkTypes.find((definition) => definition.id === entity.type)} className="size-3" />
            {entity.label}
            <IconButton type="button" variant="ghost" size="sm" onClick={() => setLinkedEntities((prev) => prev.filter((e) => e.id !== entity.id))} className="h-auto text-muted-foreground hover:text-foreground p-0" aria-label={t('customers.schedule.removeLink', 'Remove link')}>
              <X className="size-2.5" />
            </IconButton>
          </div>
        ))}
        <EntityLinkSearchPopover
          existingIds={new Set(linkedEntities.map((e) => e.id))}
          linkTypes={linkTypes}
          onAdd={(entity) => setLinkedEntities((prev) => [...prev, entity])}
          onAddMany={(entities) => setLinkedEntities((prev) => [...prev, ...entities])}
          t={t}
        />
      </div>
    </div>
  )
}
