"use client"

import * as React from 'react'
import Link from 'next/link'
import { Save, Trash2, Users, Workflow } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'
import { ObjectHistoryButton } from './ObjectHistoryButton'
import { useCustomerDictionary } from './hooks/useCustomerDictionary'
import { formatFallbackLabel } from './utils'
import { isTerminalPipelineOutcomeLabel } from './pipelineStageUtils'
import { StageSelectMenu, type StageSelectOption } from './StageSelectMenu'

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
  /** Injected controls (e.g. the Ask AI trigger) rendered at the start of the action cluster. */
  extraActions?: React.ReactNode
  /** A second, quieter row under the action cluster, e.g. the Close deal menu. */
  secondaryActions?: React.ReactNode
  /**
   * @deprecated The built-in page moves stages from the `PipelineStepper` strip. Passed together with
   * `onStageChange`, these inputs still render a stage menu in the action cluster. Kept for at least one
   * minor release after 0.10.0; see `UPGRADE_NOTES.md`.
   */
  stageOptions?: StageSelectOption[]
  /** @deprecated See `stageOptions`. */
  currentStageId?: string | null
  /** @deprecated See `stageOptions`. */
  onStageChange?: (stageId: string) => Promise<void> | void
  /** @deprecated See `stageOptions`. */
  isStageSaving?: boolean
  onSave: () => void
  onDelete: () => Promise<void> | void
  isDirty: boolean
  isSaving: boolean
  actions?: React.ReactNode
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

type HeaderChipVariant = 'info' | 'warning' | 'success' | 'error' | 'neutral'

const headerChipDotVariantClasses: Record<HeaderChipVariant, string> = {
  info: 'bg-status-info-icon',
  warning: 'bg-status-warning-icon',
  success: 'bg-status-success-icon',
  error: 'bg-status-error-icon',
  neutral: 'bg-status-neutral-icon',
}

const HEADER_ICON_BUTTON_CLASS = 'size-8 rounded-md'

function HeaderFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  )
}

function HeaderChip({
  children,
  icon,
  variant,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  variant?: HeaderChipVariant
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-muted px-2 py-1 text-xs font-medium leading-none text-muted-foreground">
      {variant ? <span className={cn('size-2 rounded-full', headerChipDotVariantClasses[variant])} /> : null}
      {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      {children}
    </span>
  )
}

export function DealDetailHeader({
  deal,
  owner,
  people,
  companies,
  pipelineName,
  extraActions = null,
  secondaryActions = null,
  stageOptions = [],
  currentStageId = null,
  onStageChange,
  isStageSaving = false,
  onSave,
  onDelete,
  isDirty,
  isSaving,
  actions,
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
  const expectedCloseOverdue = React.useMemo(() => {
    if (!deal.expectedCloseAt || deal.closureOutcome) return false
    const date = new Date(deal.expectedCloseAt)
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
  }, [deal.closureOutcome, deal.expectedCloseAt])
  const primaryCompany = companies[0] ?? null
  const statusLabel = statusEntry?.label ?? (deal.status ? formatFallbackLabel(deal.status) : null)
  const showStatusChip = statusLabel && (!deal.closureOutcome || !isTerminalPipelineOutcomeLabel(deal.status))
  const pipelineBadgeLabel = pipelineName ?? null
  const legacyStageMenu = stageOptions.length > 0 && !deal.closureOutcome && typeof onStageChange === 'function' ? (
    <StageSelectMenu
      stages={stageOptions}
      currentStageId={currentStageId}
      onStageChange={onStageChange}
      disabled={isDirty || isSaving}
      isSaving={isStageSaving}
      showCurrentStage
    />
  ) : null
  const messageSubtitle = React.useMemo(() => (
    [companyLabel, amountLabel].filter(Boolean).join(', ') || statusLabel || undefined
  ), [amountLabel, companyLabel, statusLabel])

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
      <div className="flex min-w-0 gap-5">
        <div className="min-w-0 space-y-3">
          <h1 className="min-w-0 truncate text-2xl font-normal leading-tight text-foreground">
            {deal.title || t('customers.deals.detail.untitled', 'Untitled deal')}
          </h1>
          <dl className="flex flex-wrap gap-x-10 gap-y-3 pt-1">
            {amountLabel ? (
              <HeaderFact label={t('customers.deals.detail.facts.value', 'Value')}>
                <span className="text-xl leading-tight tabular-nums">{amountLabel}</span>
              </HeaderFact>
            ) : null}
            {primaryCompany ? (
              <HeaderFact label={t('customers.deals.detail.facts.company', 'Company')}>
                <Link href={`/backend/customers/companies-v2/${primaryCompany.id}`} className="hover:underline">
                  {companyLabel}
                </Link>
              </HeaderFact>
            ) : null}
            {owner ? (
              <HeaderFact label={t('customers.deals.detail.facts.owner', 'Owner')}>
                <span className="inline-flex items-center gap-1.5">
                  <Avatar label={owner.name} size="xs" variant="monochrome" />
                  {owner.name}
                </span>
              </HeaderFact>
            ) : null}
            {expectedCloseLabel ? (
              <HeaderFact label={t('customers.deals.detail.facts.expectedClose', 'Expected close')}>
                <span className={cn(expectedCloseOverdue && 'text-status-error-text')}>{expectedCloseLabel}</span>
              </HeaderFact>
            ) : null}
            {createdAtLabel ? (
              <HeaderFact label={t('customers.deals.detail.facts.createdAt', 'Created')}>
                {createdAtLabel}
              </HeaderFact>
            ) : null}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            {showStatusChip ? (
              <HeaderChip variant="info">
                {statusLabel}
              </HeaderChip>
            ) : null}
            {pipelineBadgeLabel ? (
              <HeaderChip icon={<Workflow className="size-3.5" />}>
                {pipelineBadgeLabel}
              </HeaderChip>
            ) : null}
            {!companyLabel && people.length > 0 ? (
              <HeaderChip icon={<Users className="size-3.5" />}>
                {people[0]?.label}
              </HeaderChip>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 xl:items-end">
        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          {extraActions}
          {actions}
          {legacyStageMenu}
          <SendObjectMessageDialog
            object={{
              entityModule: 'customers',
              entityType: 'deal',
              entityId: deal.id,
              previewData: {
                title: deal.title || t('customers.deals.detail.untitled', 'Untitled deal'),
                subtitle: messageSubtitle,
              },
            }}
            viewHref={`/backend/customers/deals/${deal.id}`}
            buttonVariant="outline"
            buttonSize="icon"
            buttonClassName={HEADER_ICON_BUTTON_CLASS}
            buttonLabel={t('customers.deals.detail.actions.sendMessage', 'Send message')}
          />
          <ObjectHistoryButton
            resourceKind="customers.deal"
            resourceId={deal.id}
            organizationId={deal.organizationId ?? undefined}
            includeRelated
          />
          <IconButton
            variant="outline"
            size="sm"
            type="button"
            aria-label={t('customers.deals.detail.actions.delete', 'Delete')}
            className="h-8 w-8 rounded-md"
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
            className="h-8 rounded-md px-3"
          >
            <Save className="size-4" />
            {t('customers.deals.detail.actions.save', 'Save')}
          </Button>
        </div>
        {secondaryActions}
      </div>
    </div>
  )
}
