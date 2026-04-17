"use client"

import * as React from 'react'
import { Building2, CalendarClock, Check, ChevronDown, FileText, Save, Trash2, Users, Workflow } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useCustomerDictionary } from './hooks/useCustomerDictionary'
import { formatFallbackLabel } from './utils'
import { isTerminalPipelineOutcomeLabel } from './pipelineStageUtils'

type DealAssociation = {
  id: string
  label: string
  subtitle: string | null
  kind: 'person' | 'company'
}

type DealDetailHeaderProps = {
  deal: {
    id: string
    title: string
    status: string | null
    pipelineStage: string | null
    valueAmount: string | null
    valueCurrency: string | null
    expectedCloseAt: string | null
    createdAt: string
    closureOutcome: 'won' | 'lost' | null
    organizationId: string | null
  }
  owner?: { id: string; name: string; email: string } | null
  people: DealAssociation[]
  companies: DealAssociation[]
  pipelineName?: string | null
  stageOptions?: Array<{ id: string; label: string; order: number }>
  currentStageId?: string | null
  onStageChange?: (stageId: string) => Promise<void> | void
  isStageSaving?: boolean
  onSave: () => void
  onDelete: () => Promise<void> | void
  isDirty: boolean
  isSaving: boolean
}

function formatCurrency(amount: string | null, currency: string | null): string | null {
  if (!amount) return null
  const parsed = Number(amount)
  if (!Number.isFinite(parsed)) return currency ? `${amount} ${currency}` : amount
  if (!currency) return parsed.toLocaleString()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(parsed)
  } catch {
    return `${parsed.toLocaleString()} ${currency}`
  }
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function HeaderChip({
  children,
  icon,
  dotColor,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  dotColor?: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] bg-muted px-[8px] py-[4px] text-xs font-medium leading-none text-muted-foreground">
      {dotColor ? <span className="size-2 rounded-full" style={{ backgroundColor: dotColor }} /> : null}
      {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      {children}
    </span>
  )
}

function StageActionButton({
  stageOptions,
  currentStageId,
  onStageChange,
  disabled,
  isSaving,
}: {
  stageOptions: Array<{ id: string; label: string; order: number }>
  currentStageId: string | null
  onStageChange: (stageId: string) => Promise<void> | void
  disabled: boolean
  isSaving: boolean
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const sortedStages = React.useMemo(
    () =>
      [...stageOptions]
        .filter((stage) => !isTerminalPipelineOutcomeLabel(stage.label))
        .sort((left, right) => left.order - right.order),
    [stageOptions],
  )
  const currentStage = React.useMemo(
    () => sortedStages.find((stage) => stage.id === currentStageId) ?? null,
    [currentStageId, sortedStages],
  )

  if (!sortedStages.length) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || isSaving}
          className="h-8 max-w-[13rem] rounded-[6px] px-3"
        >
          <Workflow className="size-4" />
          <span className="truncate">
            {currentStage?.label ?? t('customers.deals.detail.actions.moveStage', 'Move stage')}
          </span>
          <ChevronDown className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <div className="border-b border-border px-3 py-2">
          <div className="text-xs font-semibold text-foreground">
            {t('customers.deals.detail.stageMenu.title', 'Update pipeline stage')}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t('customers.deals.detail.stageMenu.description', 'Move the deal forward without opening the form.')}
          </div>
        </div>
        <div className="py-1">
          {sortedStages.map((stage) => {
            const isCurrent = stage.id === currentStageId
            return (
              <Button
                key={stage.id}
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || isSaving || isCurrent}
                className="h-auto w-full justify-between rounded-[6px] px-3 py-2 text-left"
                onClick={() => {
                  setOpen(false)
                  if (!isCurrent) {
                    void onStageChange(stage.id)
                  }
                }}
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {stage.label}
                </span>
                {isCurrent ? <Check className="size-4 text-foreground" /> : null}
              </Button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function DealDetailHeader({
  deal,
  owner,
  people,
  companies,
  pipelineName,
  stageOptions = [],
  currentStageId = null,
  onStageChange,
  isStageSaving = false,
  onSave,
  onDelete,
  isDirty,
  isSaving,
}: DealDetailHeaderProps) {
  const t = useT()
  const amountLabel = React.useMemo(
    () => formatCurrency(deal.valueAmount, deal.valueCurrency),
    [deal.valueAmount, deal.valueCurrency],
  )
  const createdAtLabel = React.useMemo(() => formatDate(deal.createdAt), [deal.createdAt])
  const expectedCloseLabel = React.useMemo(() => formatDate(deal.expectedCloseAt), [deal.expectedCloseAt])
  const { data: statusDictionary } = useCustomerDictionary('deal-statuses', 0, deal.organizationId ?? null)
  const statusEntry = deal.status ? statusDictionary?.map?.[deal.status] : null
  const companyLabel = React.useMemo(() => {
    const primaryCompany = companies[0]
    if (!primaryCompany) return null
    const extraCount = companies.length - 1
    return extraCount > 0 ? `${primaryCompany.label} +${extraCount}` : primaryCompany.label
  }, [companies])
  const timelineLabel = React.useMemo(() => {
    if (createdAtLabel && expectedCloseLabel) {
      return t('customers.deals.detail.header.timeline', 'Created {{created}} · Expected close {{expected}}', {
        created: createdAtLabel,
        expected: expectedCloseLabel,
      })
    }
    if (createdAtLabel) {
      return t('customers.deals.detail.header.createdAt', 'Created {{date}}', { date: createdAtLabel })
    }
    if (expectedCloseLabel) {
      return t('customers.deals.detail.header.expectedClose', 'Expected close {{date}}', { date: expectedCloseLabel })
    }
    return null
  }, [createdAtLabel, expectedCloseLabel, t])
  const statusLabel = statusEntry?.label ?? (deal.status ? formatFallbackLabel(deal.status) : null)
  const showStatusChip = statusLabel && (!deal.closureOutcome || !isTerminalPipelineOutcomeLabel(deal.status))
  const pipelineBadgeLabel = pipelineName ?? null
  const canMoveStage = stageOptions.length > 0 && !deal.closureOutcome && typeof onStageChange === 'function'

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
      <div className="flex min-w-0 gap-5">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-[10px] border border-border bg-muted text-muted-foreground">
          <FileText className="size-7" />
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="min-w-0 truncate text-2xl font-bold leading-tight text-foreground md:text-2xl">
              {deal.title || t('customers.deals.detail.untitled', 'Untitled deal')}
            </h1>
            <span className="rounded-[3px] bg-muted px-[8px] py-[3px] text-overline font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {t('customers.deals.detail.badge.deal', 'Deal')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {companyLabel ? (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-3.5" />
                {companyLabel}
              </span>
            ) : null}
            {timelineLabel ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-3.5" />
                {timelineLabel}
              </span>
            ) : null}
            {amountLabel ? (
              <span className="font-semibold text-foreground">{amountLabel}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showStatusChip ? (
              <HeaderChip dotColor="#3b82f6">
                {statusLabel}
              </HeaderChip>
            ) : null}
            {deal.pipelineStage && !isTerminalPipelineOutcomeLabel(deal.pipelineStage) ? (
              <HeaderChip dotColor="#f29f12">
                {deal.pipelineStage}
              </HeaderChip>
            ) : null}
            {pipelineBadgeLabel ? (
              <HeaderChip icon={<Workflow className="size-3.5" />}>
                {pipelineBadgeLabel}
              </HeaderChip>
            ) : null}
            {deal.closureOutcome ? (
              <HeaderChip dotColor={deal.closureOutcome === 'won' ? '#12bd5f' : '#e33239'}>
                {deal.closureOutcome === 'won'
                  ? t('customers.deals.detail.badge.won', 'Won')
                  : t('customers.deals.detail.badge.lost', 'Lost')}
              </HeaderChip>
            ) : null}
            {!companyLabel && people.length > 0 ? (
              <HeaderChip icon={<Users className="size-3.5" />}>
                {people[0]?.label}
              </HeaderChip>
            ) : null}
            {owner && !pipelineBadgeLabel ? (
              <HeaderChip icon={<Workflow className="size-3.5" />}>
                {owner.name}
              </HeaderChip>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 xl:justify-end">
        {canMoveStage ? (
          <StageActionButton
            stageOptions={stageOptions}
            currentStageId={currentStageId}
            onStageChange={onStageChange}
            disabled={isDirty || isSaving}
            isSaving={isStageSaving}
          />
        ) : null}
        <IconButton
          variant="outline"
          size="sm"
          type="button"
          aria-label={t('customers.deals.detail.actions.delete', 'Delete')}
          className="h-8 w-8 rounded-[6px]"
          onClick={() => {
            void onDelete()
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          className="h-8 rounded-[6px] px-3"
        >
          <Save className="size-4" />
          {t('customers.deals.detail.actions.save', 'Save')}
        </Button>
      </div>
    </div>
  )
}
