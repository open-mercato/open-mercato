'use client'

import * as React from 'react'
import { Building2, Briefcase, Check, FileText, Search, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasMoreFromPage } from '@open-mercato/shared/lib/pagination/load-more'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible, getFieldLabel } from './fieldConfig'
import type { LinkedEntity } from './useScheduleFormState'

const ENTITY_LINK_TYPES = ['company', 'deal', 'offer'] as const

const PAGE_SIZE = 20

function readLabelCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveLinkedEntityLabel(
  item: Record<string, unknown>,
  linkType: 'company' | 'deal' | 'offer',
): string {
  if (linkType === 'offer') {
    const quoteNumber =
      readLabelCandidate(item.quoteNumber)
      ?? readLabelCandidate(item.quote_number)
      ?? readLabelCandidate(item.documentNumber)
      ?? readLabelCandidate(item.document_number)
      ?? readLabelCandidate(item.externalReference)
      ?? readLabelCandidate(item.external_reference)
    const customerName =
      readLabelCandidate(item.customerName)
      ?? readLabelCandidate(item.customer_name)
      ?? readLabelCandidate(item.display_name)
      ?? readLabelCandidate(item.displayName)
      ?? readLabelCandidate(item.name)
      ?? readLabelCandidate(item.title)
    if (quoteNumber && customerName) return `${quoteNumber} · ${customerName}`
    if (quoteNumber) return quoteNumber
    if (customerName) return customerName
  }

  if (linkType === 'deal') {
    const dealLabel =
      readLabelCandidate(item.title)
      ?? readLabelCandidate(item.name)
      ?? readLabelCandidate(item.display_name)
      ?? readLabelCandidate(item.displayName)
    if (dealLabel) return dealLabel
  }

  return (
    readLabelCandidate(item.display_name)
    ?? readLabelCandidate(item.displayName)
    ?? readLabelCandidate(item.name)
    ?? readLabelCandidate(item.title)
    ?? String(item.id ?? '')
  )
}

// Same dismiss pattern as ParticipantsField: outside pointer-down or Escape
// closes only the panel (Escape is swallowed so the dialog stays open).
function useDropdownDismiss(open: boolean, onClose: () => void): React.RefObject<HTMLDivElement | null> {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, onClose])
  return rootRef
}

function EntityLinkSearchPopover({
  existingIds,
  onAdd,
  onAddMany,
  t,
}: {
  existingIds: Set<string>
  onAdd: (entity: LinkedEntity) => void
  onAddMany: (entities: LinkedEntity[]) => void
  t: (key: string, fallback: string) => string
}) {
  const [open, setOpen] = React.useState(false)
  const closeDropdown = React.useCallback(() => setOpen(false), [])
  const rootRef = useDropdownDismiss(open, closeDropdown)
  const [linkType, setLinkType] = React.useState<'company' | 'deal' | 'offer'>('company')
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
    const searchParam = query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''
    const pagingParam = `&page=${page}&pageSize=${PAGE_SIZE}`
    const endpoint = linkType === 'company'
      ? `/api/customers/companies?sortField=name&sortDir=asc${pagingParam}${searchParam}`
      : linkType === 'deal'
        ? `/api/customers/deals?pageSize=${PAGE_SIZE}&page=${page}${searchParam}`
        : `/api/sales/quotes?pageSize=${PAGE_SIZE}&page=${page}${searchParam}`
    readApiResultOrThrow<{ items?: Array<Record<string, unknown>>; totalPages?: number; page?: number; pageSize?: number; total?: number }>(endpoint, { signal: controller.signal })
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : []
        const nextResults = items.map((item) => ({
          id: typeof item?.id === 'string' ? item.id : '',
          label: resolveLinkedEntityLabel(item, linkType),
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
    <div ref={rootRef} className="relative">
      <Input
        type="text"
        leftIcon={<Search />}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={t('customers.schedule.searchEntity', 'Search...')}
        aria-expanded={open}
      />
      {open ? (
      <div className="absolute z-dropdown mt-1 w-full rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
        <SegmentedControl
          value={linkType}
          onValueChange={(next) => { setLinkType(next as typeof linkType); setQuery('') }}
          aria-label={t('customers.schedule.linkTypeSwitcher', 'Link type')}
          className="mb-2 w-full"
        >
          {ENTITY_LINK_TYPES.map((type) => (
            <SegmentedControlItem key={type} value={type} className="min-w-0 flex-1 gap-1.5">
              {type === 'company' ? <Building2 className="size-3.5 shrink-0" /> : type === 'deal' ? <Briefcase className="size-3.5 shrink-0" /> : <FileText className="size-3.5 shrink-0" />}
              <span className="truncate">{type === 'company' ? t('customers.schedule.linkType.company', 'Company') : type === 'deal' ? t('customers.schedule.linkType.deal', 'Deal') : t('customers.schedule.linkType.offer', 'Offer')}</span>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {selectableResults.length ? (
          <div className="mb-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                onAddMany(
                  selectableResults.map((result) => ({
                    id: result.id,
                    type: linkType,
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
                  onAdd({ id: r.id, type: linkType, label: r.label })
                  setQuery('')
                }}
                className={cn(
                  'h-9 flex w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
                  alreadyLinked ? 'cursor-default disabled:bg-transparent disabled:text-foreground disabled:opacity-100' : 'hover:bg-accent cursor-pointer',
                )}
              >
                {linkType === 'company' ? <Building2 className="size-3.5 text-muted-foreground shrink-0" /> : linkType === 'deal' ? <Briefcase className="size-3.5 text-muted-foreground shrink-0" /> : <FileText className="size-3.5 text-muted-foreground shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                {alreadyLinked ? <Check className="size-3.5 shrink-0 text-status-success-icon" aria-hidden /> : null}
              </Button>
            )
          })}
          {!loading && hasMore ? (
            <div className="px-2 py-2">
              <Button type="button" variant="outline" className="w-full" onClick={() => setPage((current) => current + 1)}>
                {t('customers.schedule.loadMore', 'Load more')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      ) : null}
    </div>
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

  if (!isVisible(activityType, 'linkedEntities')) return null

  const sectionLabel = getFieldLabel(
    activityType,
    'linkedEntities',
    t,
    'customers.schedule.linkedEntities',
    'Linked entities',
  )

  return (
    <div>
      <label className="text-sm font-medium">
        {sectionLabel}
      </label>
      {/* Action first, tags underneath. */}
      <div className="mt-2">
        <EntityLinkSearchPopover
          existingIds={new Set(linkedEntities.map((e) => e.id))}
          onAdd={(entity) => setLinkedEntities((prev) => [...prev, entity])}
          onAddMany={(entities) => setLinkedEntities((prev) => [...prev, ...entities])}
          t={t}
        />
      </div>
      {linkedEntities.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* DS Tag [1.1] (Figma 431:16147): compact radius-6 rect, icon + label + × */}
          {linkedEntities.map((entity) => (
            <div
              key={entity.id}
              className="inline-flex h-6 items-center gap-1 rounded-sm bg-muted px-1.5 text-xs font-medium text-foreground"
            >
              {entity.type === 'company' ? <Building2 className="size-3 text-muted-foreground" /> : entity.type === 'deal' ? <Briefcase className="size-3 text-muted-foreground" /> : <FileText className="size-3 text-muted-foreground" />}
              <span className="max-w-48 truncate">{entity.label}</span>
              <IconButton type="button" variant="ghost" size="sm" onClick={() => setLinkedEntities((prev) => prev.filter((e) => e.id !== entity.id))} className="h-auto text-muted-foreground hover:text-foreground p-0" aria-label={t('customers.schedule.removeLink', 'Remove link')}>
                <X className="size-2.5" />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
