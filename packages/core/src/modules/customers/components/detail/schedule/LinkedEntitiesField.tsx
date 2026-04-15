'use client'

import * as React from 'react'
import { Building2, Briefcase, FileText, Search, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible } from './fieldConfig'
import type { LinkedEntity } from './useScheduleFormState'

const ENTITY_LINK_TYPES = ['company', 'deal', 'offer'] as const

function EntityLinkSearchPopover({
  existingIds,
  onAdd,
  t,
}: {
  existingIds: Set<string>
  onAdd: (entity: LinkedEntity) => void
  t: (key: string, fallback: string) => string
}) {
  const [open, setOpen] = React.useState(false)
  const [linkType, setLinkType] = React.useState<'company' | 'deal' | 'offer'>('company')
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Array<{ id: string; label: string }>>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    const searchParam = query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''
    const endpoint = linkType === 'company'
      ? `/api/customers/companies?pageSize=10${searchParam}`
      : linkType === 'deal'
        ? `/api/customers/deals?pageSize=10${searchParam}`
        : `/api/sales/quotes?pageSize=10${searchParam}`
    readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(endpoint, { signal: controller.signal })
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : []
        setResults(items.map((item) => ({
          id: typeof item?.id === 'string' ? item.id : '',
          label: typeof item?.display_name === 'string' ? item.display_name
            : typeof item?.displayName === 'string' ? item.displayName
            : typeof item?.title === 'string' ? item.title
            : typeof item?.name === 'string' ? item.name
            : String(item?.id ?? ''),
        })).filter((r) => r.id))
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [open, query, linkType])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-auto inline-flex items-center gap-[6px] rounded-[999px] border border-border bg-background px-[10px] py-[6px] text-[12px] text-muted-foreground">
          <span className="text-[13px]">+</span>
          {t('customers.schedule.addLink', 'Add link')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="flex gap-1 mb-2">
          {ENTITY_LINK_TYPES.map((type) => (
            <Button
              key={type}
              type="button"
              variant={linkType === type ? 'default' : 'ghost'}
              size="sm"
              className="h-6 text-xs flex-1"
              onClick={() => { setLinkType(type as typeof linkType); setQuery('') }}
            >
              {type === 'company' ? <Building2 className="mr-1 size-3" /> : type === 'deal' ? <Briefcase className="mr-1 size-3" /> : <FileText className="mr-1 size-3" />}
              {type === 'company' ? t('customers.schedule.linkType.company', 'Company') : type === 'deal' ? t('customers.schedule.linkType.deal', 'Deal') : t('customers.schedule.linkType.offer', 'Offer')}
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
                  setOpen(false)
                  setQuery('')
                }}
                className={cn(
                  'h-auto flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  alreadyLinked ? 'opacity-40 cursor-default' : 'hover:bg-accent cursor-pointer',
                )}
              >
                {linkType === 'company' ? <Building2 className="size-3.5 text-muted-foreground shrink-0" /> : linkType === 'deal' ? <Briefcase className="size-3.5 text-muted-foreground shrink-0" /> : <FileText className="size-3.5 text-muted-foreground shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
              </Button>
            )
          })}
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

  if (!isVisible(activityType, 'linkedEntities')) return null

  return (
    <div>
      <label className="text-[11px] font-semibold uppercase text-muted-foreground tracking-[0.5px]">
        {t('customers.schedule.linkedEntities', 'Linked entities')}
      </label>
      <div className="mt-[10px] flex flex-wrap content-center items-center gap-[8px]">
        {linkedEntities.map((entity) => (
          <div
            key={entity.id}
            className={cn(
              'inline-flex items-center gap-[6px] rounded-[999px] border px-[10px] py-[6px] text-[12px]',
              entity.type === 'deal'
                ? 'border-emerald-300 bg-emerald-50 font-semibold text-foreground dark:border-emerald-700 dark:bg-emerald-950'
                : 'border-border bg-muted text-foreground',
            )}
          >
            {entity.type === 'company' ? <Building2 className="size-[13px]" /> : entity.type === 'deal' ? <Briefcase className="size-[13px]" /> : <FileText className="size-[13px]" />}
            {entity.label}
            <IconButton type="button" variant="ghost" size="sm" onClick={() => setLinkedEntities((prev) => prev.filter((e) => e.id !== entity.id))} className="h-auto text-muted-foreground hover:text-foreground p-0" aria-label={t('customers.schedule.removeLink', 'Remove link')}>
              <X className="size-[10px]" />
            </IconButton>
          </div>
        ))}
        <EntityLinkSearchPopover
          existingIds={new Set(linkedEntities.map((e) => e.id))}
          onAdd={(entity) => setLinkedEntities((prev) => [...prev, entity])}
          t={t}
        />
      </div>
    </div>
  )
}
