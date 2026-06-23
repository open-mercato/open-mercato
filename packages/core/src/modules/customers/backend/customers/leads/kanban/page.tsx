"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { LeadQualificationDialog } from '../../../../components/detail/LeadQualificationDialog'

type LeadCard = {
  id: string
  title: string
  status: string
  companyName: string | null
  contactFirstName: string | null
  contactLastName: string | null
  estimatedValueAmount: number | null
  estimatedValueCurrency: string | null
  updatedAt: string
}

type LeadsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
}

type Lane = {
  id: string
  labelKey: string
  fallbackLabel: string
}

const LANES: Lane[] = [
  { id: 'open', labelKey: 'customers.leads.kanban.lane.open', fallbackLabel: 'Open' },
  { id: 'in_progress', labelKey: 'customers.leads.kanban.lane.in_progress', fallbackLabel: 'In progress' },
  { id: 'qualified', labelKey: 'customers.leads.kanban.lane.qualified', fallbackLabel: 'Qualified' },
  { id: 'rejected', labelKey: 'customers.leads.kanban.lane.rejected', fallbackLabel: 'Rejected' },
]

const LEADS_LIMIT = 100

function mapLead(item: Record<string, unknown>): LeadCard | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const title = typeof item.title === 'string' ? item.title : ''
  const status = typeof item.status === 'string' ? item.status : 'open'
  const companyName =
    typeof item.companyName === 'string' ? item.companyName :
    typeof item.company_name === 'string' ? item.company_name : null
  const contactFirstName =
    typeof item.contactFirstName === 'string' ? item.contactFirstName :
    typeof item.contact_first_name === 'string' ? item.contact_first_name : null
  const contactLastName =
    typeof item.contactLastName === 'string' ? item.contactLastName :
    typeof item.contact_last_name === 'string' ? item.contact_last_name : null
  const amountRaw = item.estimatedValueAmount ?? item.estimated_value_amount
  const estimatedValueAmount =
    typeof amountRaw === 'number'
      ? amountRaw
      : typeof amountRaw === 'string' && amountRaw.trim()
        ? Number(amountRaw)
        : null
  const estimatedValueCurrency =
    typeof item.estimatedValueCurrency === 'string' && item.estimatedValueCurrency.trim().length
      ? item.estimatedValueCurrency.trim().toUpperCase()
      : typeof item.estimated_value_currency === 'string' && item.estimated_value_currency.trim().length
        ? item.estimated_value_currency.trim().toUpperCase()
        : null
  const updatedAt =
    typeof item.updatedAt === 'string' ? item.updatedAt :
    typeof item.updated_at === 'string' ? item.updated_at : ''
  return {
    id,
    title,
    status,
    companyName,
    contactFirstName,
    contactLastName,
    estimatedValueAmount,
    estimatedValueCurrency,
    updatedAt,
  }
}

function formatCurrency(amount: number | null, currency: string | null, fallback: string): string {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return fallback
  try {
    if (currency && currency.trim().length) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
    }
    return new Intl.NumberFormat(undefined, { style: 'decimal', maximumFractionDigits: 2 }).format(amount)
  } catch {
    return fallback
  }
}

export default function LeadsKanbanPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [leads, setLeads] = React.useState<LeadCard[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [activeLane, setActiveLane] = React.useState<string | null>(null)
  const [pendingLeadId, setPendingLeadId] = React.useState<string | null>(null)
  const [qualifyDialog, setQualifyDialog] = React.useState<{
    open: boolean
    leadId: string
    leadUpdatedAt: string
    hasContactName: boolean
    hasCompanyName: boolean
  }>({ open: false, leadId: '', leadUpdatedAt: '', hasContactName: false, hasCompanyName: false })
  const [reloadToken, setReloadToken] = React.useState(0)

  const loadLeads = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('pageSize', String(LEADS_LIMIT))
      const call = await apiCall<LeadsResponse>(`/api/customers/leads?${params.toString()}`)
      if (!call.ok) {
        setError(t('customers.leads.list.error', 'Failed to load leads.'))
        setLeads([])
        return
      }
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      const mapped = items
        .map((item) => mapLead(item as Record<string, unknown>))
        .filter((card): card is LeadCard => card !== null)
      setLeads(mapped)
    } catch {
      setError(t('customers.leads.list.error', 'Failed to load leads.'))
      setLeads([])
    } finally {
      setIsLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    loadLeads().catch(() => {})
  }, [loadLeads, scopeVersion, reloadToken])

  const groupedLeads = React.useMemo(() => {
    const map = new Map<string, LeadCard[]>()
    for (const lane of LANES) {
      map.set(lane.id, [])
    }
    for (const lead of leads) {
      const lane = map.get(lead.status)
      if (lane) lane.push(lead)
    }
    return map
  }, [leads])

  const leadMap = React.useMemo(() => {
    const map = new Map<string, LeadCard>()
    for (const lead of leads) {
      map.set(lead.id, lead)
    }
    return map
  }, [leads])

  const updateLeadStatus = React.useCallback(
    async (leadId: string, newStatus: string, leadUpdatedAt: string) => {
      setPendingLeadId(leadId)
      try {
        await apiCallOrThrow(
          '/api/customers/leads',
          {
            method: 'PUT',
            headers: {
              'content-type': 'application/json',
              'if-match': leadUpdatedAt,
            },
            body: JSON.stringify({ id: leadId, status: newStatus }),
          },
          { errorMessage: t('customers.leads.update.error', 'Failed to update lead.') },
        )
        flash(t('customers.leads.detail.saveSuccess', 'Lead saved.'), 'success')
        setReloadToken((token) => token + 1)
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('customers.leads.update.error', 'Failed to update lead.')
        flash(message, 'error')
      } finally {
        setPendingLeadId(null)
      }
    },
    [t],
  )

  const handleDragStart = React.useCallback((leadId: string) => {
    setDraggingId(leadId)
  }, [])

  const handleDragEnd = React.useCallback(() => {
    setDraggingId(null)
    setActiveLane(null)
  }, [])

  const handleDragOver = React.useCallback(
    (laneId: string) => (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (activeLane !== laneId) setActiveLane(laneId)
    },
    [activeLane],
  )

  const handleDrop = React.useCallback(
    (lane: Lane) => async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setActiveLane(null)
      const leadId = event.dataTransfer.getData('text/plain') || draggingId
      if (!leadId) return
      const lead = leadMap.get(leadId)
      if (!lead) return
      if (lead.status === lane.id) return

      if (lane.id === 'qualified') {
        setQualifyDialog({
          open: true,
          leadId: lead.id,
          leadUpdatedAt: lead.updatedAt,
          hasContactName: !!(lead.contactFirstName && lead.contactLastName),
          hasCompanyName: !!(lead.companyName && lead.companyName.trim().length),
        })
        return
      }

      if (lead.status === 'qualified') {
        flash(
          t('customers.leads.kanban.convertedCannotMove', 'Converted leads cannot be moved.'),
          'info',
        )
        return
      }

      await updateLeadStatus(leadId, lane.id, lead.updatedAt)
    },
    [draggingId, leadMap, updateLeadStatus, t],
  )

  const handleConverted = React.useCallback(() => {
    setQualifyDialog((prev) => ({ ...prev, open: false }))
    setReloadToken((token) => token + 1)
  }, [])

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col">
              <h1 className="text-xl font-semibold text-foreground">
                {t('customers.leads.kanban.title', 'Leads board')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t(
                  'customers.leads.kanban.subtitle',
                  'Drag leads between lanes to update status. Drag to Qualified to open the qualification dialog.',
                )}
              </p>
            </div>
            <Button asChild>
              <Link href="/backend/customers/leads/create">
                {t('customers.leads.list.actions.new', 'New lead')}
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <div className="flex h-[50vh] items-center justify-center">
              <Spinner />
            </div>
          ) : error ? (
            <div className="max-w-xl">
              <ErrorNotice message={error} />
              <Button variant="outline" className="mt-3" onClick={() => loadLeads()}>
                {t('customers.leads.list.retry', 'Retry')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {leads.length > LEADS_LIMIT ? (
                <div className="rounded-md border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
                  {t(
                    'customers.leads.kanban.limitNotice',
                    'Showing the first {count} leads. Refine your filters to see more.',
                    { count: leads.length },
                  )}
                </div>
              ) : null}

              <div className="flex flex-col gap-4 pb-6 md:flex-row md:overflow-x-auto">
                {LANES.map((lane) => {
                  const laneLeads = groupedLeads.get(lane.id) ?? []
                  const isActive = activeLane === lane.id
                  return (
                    <div
                      key={lane.id}
                      className={`flex min-h-[60vh] w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all md:w-72 md:flex-none ${
                        isActive ? 'ring-2 ring-ring/40' : ''
                      }`}
                      onDragOver={handleDragOver(lane.id)}
                      onDrop={handleDrop(lane)}
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {t(lane.labelKey, lane.fallbackLabel)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t('customers.leads.kanban.countLabel', 'Leads: {count}', {
                              count: laneLeads.length,
                            })}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
                        {laneLeads.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
                            {t('customers.leads.kanban.emptyLane', 'No leads in this lane yet.')}
                          </div>
                        ) : (
                          laneLeads.map((lead) => {
                            const isDragging =
                              draggingId === lead.id ||
                              (pendingLeadId === lead.id)
                            const contactName = [lead.contactFirstName, lead.contactLastName]
                              .filter(Boolean)
                              .join(' ')
                              .trim()
                            const valueLabel = formatCurrency(
                              lead.estimatedValueAmount,
                              lead.estimatedValueCurrency,
                              t('customers.leads.list.noValue', '—'),
                            )
                            return (
                              <div
                                key={lead.id}
                                className={`group flex cursor-grab flex-col gap-2 rounded-md border border-border bg-background p-4 shadow-xs transition ${
                                  isDragging ? 'opacity-50' : 'hover:shadow-sm'
                                }`}
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = 'move'
                                  event.dataTransfer.setData('text/plain', lead.id)
                                  handleDragStart(lead.id)
                                }}
                                onDragEnd={handleDragEnd}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <Link
                                    href={`/backend/customers/leads/${lead.id}`}
                                    className="flex flex-col hover:underline"
                                  >
                                    <span className="line-clamp-2 text-sm font-medium text-foreground">
                                      {lead.title}
                                    </span>
                                    {lead.companyName ? (
                                      <span className="text-xs text-muted-foreground">
                                        {lead.companyName}
                                      </span>
                                    ) : null}
                                  </Link>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  {contactName ? (
                                    <span className="rounded border border-border px-1.5 py-0.5">
                                      {contactName}
                                    </span>
                                  ) : null}
                                  {lead.estimatedValueAmount !== null ? (
                                    <span className="rounded border border-border px-1.5 py-0.5">
                                      {valueLabel}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </PageBody>

      <LeadQualificationDialog
        leadId={qualifyDialog.leadId}
        leadUpdatedAt={qualifyDialog.leadUpdatedAt}
        open={qualifyDialog.open}
        onOpenChange={(open) => setQualifyDialog((prev) => ({ ...prev, open }))}
        onConverted={handleConverted}
        hasContactName={qualifyDialog.hasContactName}
        hasCompanyName={qualifyDialog.hasCompanyName}
      />
    </Page>
  )
}
