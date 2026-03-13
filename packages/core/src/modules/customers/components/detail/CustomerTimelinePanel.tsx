"use client"

import * as React from 'react'
import Link from 'next/link'
import {
  ChevronDown,
} from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { TimelinePanel } from '@open-mercato/ui/backend/timeline/TimelinePanel'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { TimelineEntry } from '../../lib/timeline/types'
import { dealTimelinePanelConfig } from '../../lib/timeline/config'

type DealOption = { id: string; title: string }

export type CustomerTimelinePanelProps = {
  entityId: string
  entityType: 'company' | 'person'
  open: boolean
  onOpenChange: (open: boolean) => void
  t: TranslateFn
}

function DealFilterDropdown({
  deals,
  selectedDealId,
  onChange,
  t,
}: {
  deals: DealOption[]
  selectedDealId: string | null
  onChange: (dealId: string | null) => void
  t: TranslateFn
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (deals.length === 0) return null

  const selectedLabel = selectedDealId
    ? deals.find((deal) => deal.id === selectedDealId)?.title ?? selectedDealId
    : t('customers.timeline.allDeals', 'All deals')

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs max-w-[160px]"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className={`ml-1 h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border bg-card p-2 shadow-lg">
          <Button
            type="button"
            variant={selectedDealId === null ? 'secondary' : 'ghost'}
            size="sm"
            className="w-full justify-start text-xs h-auto py-1.5"
            onClick={() => { onChange(null); setOpen(false) }}
          >
            {t('customers.timeline.allDeals', 'All deals')}
          </Button>
          <div className="my-1 border-t" />
          {deals.map((deal) => (
            <Button
              key={deal.id}
              type="button"
              variant={selectedDealId === deal.id ? 'secondary' : 'ghost'}
              size="sm"
              className="w-full justify-start text-xs h-auto py-1.5 truncate"
              onClick={() => { onChange(deal.id); setOpen(false) }}
            >
              {deal.title}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function CustomerTimelinePanel({ entityId, entityType, open, onOpenChange, t }: CustomerTimelinePanelProps) {
  const [deals, setDeals] = React.useState<DealOption[]>([])
  const [selectedDealId, setSelectedDealId] = React.useState<string | null>(null)

  // Load deals list when panel opens for the deal filter dropdown
  React.useEffect(() => {
    if (!open) return
    readApiResultOrThrow<{ deals: DealOption[] }>(
      `/api/customers/entities/${encodeURIComponent(entityId)}/timeline?limit=1`,
    ).then((result) => {
      const payload = result as { deals?: DealOption[] }
      if (payload.deals?.length) {
        setDeals(payload.deals)
      }
    }).catch(() => { /* timeline load will show the error */ })
  }, [open, entityId])

  const titleKey = entityType === 'company'
    ? 'customers.timeline.companyTitle'
    : 'customers.timeline.personTitle'
  const title = t(titleKey, 'Customer Timeline')

  const extraParams = React.useMemo(() => {
    const params: Record<string, string> = {}
    if (selectedDealId) params.dealId = selectedDealId
    return params
  }, [selectedDealId])

  const customerPanelConfig = React.useMemo(() => ({
    ...dealTimelinePanelConfig,
    panelWidth: 'max-w-2xl',
  }), [])

  return (
    <TimelinePanel
      apiUrl={`/api/customers/entities/${encodeURIComponent(entityId)}/timeline`}
      config={customerPanelConfig}
      title={title}
      open={open}
      onOpenChange={onOpenChange}
      t={t}
      extraParams={extraParams}
      extraHeaderContent={
        <DealFilterDropdown
          deals={deals}
          selectedDealId={selectedDealId}
          onChange={setSelectedDealId}
          t={t}
        />
      }
      renderEntryBadge={(entry) => {
        const ctx = (entry as TimelineEntry).dealContext
        if (!ctx) return null
        return (
          <Link
            href={`/backend/customers/deals/${ctx.dealId}`}
            className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50 transition-colors shrink-0"
          >
            {ctx.dealTitle}
          </Link>
        )
      }}
      i18nPrefix="customers.timeline"
    />
  )
}
