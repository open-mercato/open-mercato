"use client"

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, CalendarDays, CalendarPlus, Trophy, Workflow, XCircle } from 'lucide-react'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { isLostDealStatus, isOpenDealStatus, isWonDealStatus } from '../../../../../lib/dealStatus'
import { compareDateKeys, toUtcDateKey } from '../../../../../lib/dealsTimeline'
import type { DealTimelineItem } from '../../../../../lib/dealsTimelineTypes'
import { formatCurrency } from '../../../../../components/detail/utils'
import { ScheduleActivityDialog } from '../../../../../components/detail/ScheduleActivityDialog'
import { ConfirmDealLostDialog } from '../../../../../components/detail/ConfirmDealLostDialog'
import { DealWonPopup } from '../../../../../components/detail/DealWonPopup'
import { DealLostSummaryDialog } from '../../../../../components/detail/DealLostSummaryDialog'
import { ChangeStageDialog } from '../../pipeline/components/ChangeStageDialog'
import { useDealClosure } from '../../[id]/hooks/useDealClosure'
import type { GuardedMutationRunner } from '../../[id]/hooks/types'
import { ChangeCloseDateDialog, formatUtcDateKey } from './ChangeCloseDateDialog'
import { useDealDrawerData, useDealDrawerPermissions, type DealDrawerDeal } from './useDealDrawerData'

export type TimelineDealDrawerProps = {
  dealId: string | null
  onClose: () => void
  onDealChanged: (dealId: string) => void
  onRescheduled: (result: { dealId: string; expectedCloseAt: string }) => void
  canManage: boolean
  returnFocusRef?: React.RefObject<HTMLElement | null>
  initialItem?: DealTimelineItem | null
  refreshToken?: number
  resolveOwnerName?: (ownerUserId: string) => string | null
}

type DrawerMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

const MUTATION_CONTEXT_ID = 'customers-deals-timeline:drawer'

export type DealStatusKind = 'open' | 'won' | 'lost'

export function resolveDealStatusKind(status: string | null | undefined): DealStatusKind {
  const normalized = status?.toLowerCase()
  if (isWonDealStatus(normalized)) return 'won'
  if (isLostDealStatus(normalized) || !isOpenDealStatus(normalized)) return 'lost'
  return 'open'
}

const STATUS_VARIANT: Record<DealStatusKind, StatusBadgeVariant> = {
  open: 'info',
  won: 'success',
  lost: 'error',
}

export function isDealOverdue(
  status: string | null | undefined,
  expectedCloseAt: string | null | undefined,
  today: Date = new Date(),
): boolean {
  if (!isOpenDealStatus(status?.toLowerCase())) return false
  const closeKey = toUtcDateKey(expectedCloseAt ?? null)
  const todayKey = toUtcDateKey(today)
  if (!closeKey || !todayKey) return false
  return compareDateKeys(closeKey, todayKey) < 0
}

function itemToPreview(item: DealTimelineItem): DealDrawerDeal {
  return {
    id: item.id,
    title: item.title ?? '',
    status: item.status,
    pipelineId: item.pipelineId,
    pipelineName: null,
    pipelineStageId: item.pipelineStageId,
    pipelineStage: item.pipelineStage,
    stages: [],
    valueAmount: item.valueAmount,
    valueCurrency: item.valueCurrency,
    probability: item.probability,
    expectedCloseAt: toUtcDateKey(item.expectedCloseAt),
    ownerUserId: item.ownerUserId,
    ownerName: null,
    updatedAt: item.updatedAt,
    primaryCompany: item.primaryCompany,
    primaryPerson: item.primaryPerson,
    pipelineState: null,
  }
}

function DrawerSection({
  id,
  title,
  action,
  children,
}: {
  id: string
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 text-right font-medium text-foreground">{children}</dd>
    </div>
  )
}

export function TimelineDealDrawer({
  dealId,
  onClose,
  onDealChanged,
  onRescheduled,
  canManage,
  returnFocusRef,
  initialItem,
  refreshToken,
  resolveOwnerName,
}: TimelineDealDrawerProps): React.ReactElement {
  const t = useT()
  const { state, reload } = useDealDrawerData(dealId)
  const permissions = useDealDrawerPermissions()
  const [closeDateDialogOpen, setCloseDateDialogOpen] = React.useState(false)
  const [stageDialogOpen, setStageDialogOpen] = React.useState(false)
  const [isStageSaving, setIsStageSaving] = React.useState(false)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)

  const lastRefreshTokenRef = React.useRef(refreshToken)
  React.useEffect(() => {
    if (lastRefreshTokenRef.current === refreshToken) return
    lastRefreshTokenRef.current = refreshToken
    if (dealId) void reload()
  }, [dealId, refreshToken, reload])

  React.useEffect(() => {
    if (state.status === 'missing') onClose()
  }, [onClose, state.status])

  React.useEffect(() => {
    if (!dealId) {
      setCloseDateDialogOpen(false)
      setStageDialogOpen(false)
      setScheduleOpen(false)
    }
  }, [dealId])

  const previewItem = initialItem && initialItem.id === dealId ? initialItem : null
  const deal: DealDrawerDeal | null = state.deal ?? (previewItem ? itemToPreview(previewItem) : null)
  const stageLabel = deal
    ? deal.stages.find((stage) => stage.id === deal.pipelineStageId)?.label ?? deal.pipelineStage
    : null
  const currentDealId = deal?.id ?? null

  const { runMutation, retryLastMutation } = useGuardedMutation<DrawerMutationContext>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const runMutationWithContext = React.useCallback<GuardedMutationRunner>(
    (operation, mutationPayload) =>
      runMutation({
        operation,
        mutationPayload,
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: 'customers.deal',
          resourceId: currentDealId ?? '',
          retryLastMutation,
        },
      }),
    [currentDealId, retryLastMutation, runMutation],
  )

  const refreshAfterWrite = React.useCallback(async () => {
    if (!currentDealId) return
    await reload()
    onDealChanged(currentDealId)
  }, [currentDealId, onDealChanged, reload])

  const closure = useDealClosure({
    currentDealId,
    dealUpdatedAt: deal?.updatedAt ?? null,
    runMutationWithContext,
    confirmDiscardIfDirty: async () => true,
    onClosed: refreshAfterWrite,
  })

  const handleReschedule = React.useCallback(
    async (dateKey: string) => {
      if (!deal) return
      const payload = { id: deal.id, expectedCloseAt: dateKey }
      try {
        await runMutationWithContext(
          () => withScopedApiRequestHeaders(
            buildOptimisticLockHeader(deal.updatedAt),
            () => updateCrud('customers/deals', payload),
          ),
          { ...payload, operation: 'rescheduleDeal' },
        )
      } catch (err) {
        if (!surfaceRecordConflict(err, t, { onRefresh: () => { void reload() } })) {
          flash(t('customers.deals.timeline.reschedule.error', 'Failed to change the close date.'), 'error')
        }
        await reload()
        return
      }
      setCloseDateDialogOpen(false)
      await refreshAfterWrite()
      onRescheduled({ dealId: deal.id, expectedCloseAt: dateKey })
    },
    [deal, onRescheduled, refreshAfterWrite, reload, runMutationWithContext, t],
  )

  const handleStageChange = React.useCallback(
    async (stageId: string) => {
      if (!deal || stageId === deal.pipelineStageId) {
        setStageDialogOpen(false)
        return
      }
      const payload = { id: deal.id, pipelineStageId: stageId }
      setIsStageSaving(true)
      try {
        await runMutationWithContext(
          () => withScopedApiRequestHeaders(
            buildOptimisticLockHeader(deal.updatedAt),
            () => updateCrud('customers/deals', payload),
          ),
          { ...payload, operation: 'updateDealStage' },
        )
        flash(t('customers.deals.detail.stageUpdateSuccess', 'Deal stage updated.'), 'success')
        setStageDialogOpen(false)
        await refreshAfterWrite()
      } catch (err) {
        if (!surfaceRecordConflict(err, t, { onRefresh: () => { void reload() } })) {
          flash(t('customers.deals.detail.stageUpdateError', 'Failed to update deal stage.'), 'error')
        }
        await reload()
      } finally {
        setIsStageSaving(false)
      }
    },
    [deal, refreshAfterWrite, reload, runMutationWithContext, t],
  )

  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      const target = returnFocusRef?.current
      if (target && target.isConnected) {
        event.preventDefault()
        target.focus()
      }
    },
    [returnFocusRef],
  )

  const untitled = t('customers.deals.detail.untitled', 'Untitled deal')
  const statusKind = resolveDealStatusKind(deal?.status)
  const isClosed = statusKind !== 'open'
  const canWrite = canManage && !isClosed
  const overdue = deal ? isDealOverdue(deal.status, deal.expectedCloseAt) : false
  const followUpEntity = deal?.primaryPerson
    ? { ...deal.primaryPerson, kind: 'person' as const }
    : deal?.primaryCompany
      ? { ...deal.primaryCompany, kind: 'company' as const }
      : null
  const canScheduleFollowUp = !!followUpEntity && permissions.canScheduleFollowUp
  const otherStages = deal ? deal.stages.filter((stage) => stage.id !== deal.pipelineStageId) : []
  const closeDateLabel = formatUtcDateKey(deal?.expectedCloseAt ?? null)
  const valueLabel =
    deal && deal.valueAmount != null ? formatCurrency(deal.valueAmount, deal.valueCurrency) : null
  const statusLabels: Record<DealStatusKind, string> = {
    open: t('customers.deals.timeline.drawer.status.open', 'Open'),
    won: t('customers.deals.timeline.drawer.status.won', 'Won'),
    lost: t('customers.deals.timeline.drawer.status.lost', 'Lost'),
  }

  const titleNode = deal
    ? permissions.canOpenDeal
      ? (
          <Link href={`/backend/customers/deals/${encodeURIComponent(deal.id)}`} className="hover:underline">
            {deal.title || untitled}
          </Link>
        )
      : deal.title || untitled
    : t('customers.deals.timeline.drawer.title', 'Deal')

  const sublineParts: React.ReactNode[] = []
  if (deal?.primaryCompany) {
    const company = deal.primaryCompany
    const label = company.label || t('customers.deals.timeline.drawer.companyFallback', 'Company')
    sublineParts.push(
      permissions.canOpenCompany ? (
        <Link key="company" href={`/backend/customers/companies-v2/${encodeURIComponent(company.id)}`} className="hover:underline">
          {label}
        </Link>
      ) : (
        <span key="company">{label}</span>
      ),
    )
  }
  if (deal?.primaryPerson) {
    const person = deal.primaryPerson
    const label = person.label || t('customers.deals.timeline.drawer.personFallback', 'Contact')
    sublineParts.push(
      permissions.canOpenPerson ? (
        <Link key="person" href={`/backend/customers/people-v2/${encodeURIComponent(person.id)}`} className="hover:underline">
          {label}
        </Link>
      ) : (
        <span key="person">{label}</span>
      ),
    )
  }

  return (
    <>
      <Drawer
        open={dealId != null}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      >
        <DrawerContent
          side="right"
          className="max-w-full sm:max-w-lg"
          closeAriaLabel={t('customers.deals.timeline.drawer.close', 'Close deal preview')}
          onCloseAutoFocus={handleCloseAutoFocus}
          data-testid="timeline-deal-drawer"
        >
          <DrawerHeader>
            <DrawerTitle className="truncate">{titleNode}</DrawerTitle>
            <DrawerDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {sublineParts.length
                ? sublineParts.map((part, index) => (
                    <React.Fragment key={index}>
                      {index > 0 ? <span aria-hidden="true">·</span> : null}
                      {part}
                    </React.Fragment>
                  ))
                : t('customers.deals.timeline.drawer.noAssociations', 'No linked company or contact')}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody className="pb-6">
            {!deal && state.status === 'error' ? (
              <ErrorMessage
                label={t('customers.deals.timeline.drawer.loadError', 'Failed to load the deal.')}
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
                    {t('customers.deals.timeline.drawer.retry', 'Retry')}
                  </Button>
                }
              />
            ) : !deal ? (
              <LoadingMessage label={t('customers.deals.timeline.drawer.loading', 'Loading deal…')} />
            ) : (
              <div className="flex flex-col">
                <DrawerSection
                  id="timeline-drawer-close-date"
                  title={t('customers.deals.timeline.drawer.section.closeDate', 'Expected close date')}
                  action={
                    canWrite ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setCloseDateDialogOpen(true)}>
                        <CalendarClock className="size-4" aria-hidden="true" />
                        {t('customers.deals.timeline.reschedule.action', 'Change close date')}
                      </Button>
                    ) : null
                  }
                >
                  <p
                    className={`flex items-center gap-2 text-base font-semibold ${overdue ? 'text-status-error-text' : 'text-foreground'}`}
                    data-testid="timeline-drawer-close-date"
                  >
                    {overdue ? (
                      <AlertTriangle className="size-4" aria-hidden="true" />
                    ) : (
                      <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    {closeDateLabel ?? t('customers.deals.timeline.drawer.noCloseDate', 'No close date')}
                    {overdue ? (
                      <span className="text-xs font-medium">
                        {t('customers.deals.timeline.drawer.overdue', 'Overdue')}
                      </span>
                    ) : null}
                  </p>
                  {isClosed ? (
                    <p className="text-xs text-muted-foreground">
                      {t('customers.deals.timeline.reschedule.closedHint', 'Closed deals can’t be rescheduled from the timeline.')}
                    </p>
                  ) : !canManage ? (
                    <p className="text-xs text-muted-foreground">
                      {t('customers.deals.timeline.reschedule.readOnlyHint', 'You need permission to manage deals to change the close date.')}
                    </p>
                  ) : null}
                </DrawerSection>

                <DrawerSection
                  id="timeline-drawer-summary"
                  title={t('customers.deals.timeline.drawer.section.summary', 'Summary')}
                >
                  <dl className="flex flex-col gap-2">
                    <SummaryRow label={t('customers.deals.timeline.drawer.summary.value', 'Value')}>
                      {valueLabel ?? t('customers.deals.timeline.drawer.summary.noValue', 'No value')}
                    </SummaryRow>
                    <SummaryRow label={t('customers.deals.timeline.drawer.summary.probability', 'Probability')}>
                      {deal.probability != null ? `${deal.probability}%` : '—'}
                    </SummaryRow>
                    <SummaryRow label={t('customers.deals.timeline.drawer.summary.stage', 'Stage')}>
                      <span className="truncate">
                        {stageLabel ?? t('customers.deals.timeline.drawer.summary.noStage', 'No stage')}
                      </span>
                      <StatusBadge variant={STATUS_VARIANT[statusKind]} dot>
                        {statusLabels[statusKind]}
                      </StatusBadge>
                      {canWrite && otherStages.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setStageDialogOpen(true)}
                        >
                          <Workflow className="size-4" aria-hidden="true" />
                          {t('customers.deals.timeline.drawer.action.changeStage', 'Change stage')}
                        </Button>
                      ) : null}
                    </SummaryRow>
                    <SummaryRow label={t('customers.deals.timeline.drawer.summary.owner', 'Owner')}>
                      {(deal.ownerUserId ? resolveOwnerName?.(deal.ownerUserId) : null) ??
                        deal.ownerName ??
                        (deal.ownerUserId
                          ? t('customers.deals.timeline.drawer.summary.ownerFallback', 'Owner')
                          : t('customers.deals.timeline.lane.unassigned', 'Unassigned'))}
                    </SummaryRow>
                  </dl>
                </DrawerSection>

                <DrawerSection
                  id="timeline-drawer-activity"
                  title={t('customers.deals.timeline.drawer.section.activity', 'Activity')}
                  action={
                    canScheduleFollowUp ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
                        <CalendarPlus className="size-4" aria-hidden="true" />
                        {t('customers.deals.timeline.drawer.action.scheduleFollowUp', 'Schedule follow-up')}
                      </Button>
                    ) : null
                  }
                >
                  {deal.pipelineState ? (
                    <dl className="flex flex-col gap-2">
                      <SummaryRow label={t('customers.deals.timeline.drawer.activity.openActivities', 'Open activities')}>
                        <span data-testid="timeline-drawer-open-activities">{deal.pipelineState.openActivitiesCount}</span>
                      </SummaryRow>
                      <SummaryRow label={t('customers.deals.timeline.drawer.activity.daysInStage', 'Days in stage')}>
                        <span data-testid="timeline-drawer-days-in-stage">{deal.pipelineState.daysInCurrentStage}</span>
                        {deal.pipelineState.isStuck ? (
                          <StatusBadge variant="warning">
                            {t('customers.deals.timeline.drawer.activity.stalled', 'Stalled')}
                          </StatusBadge>
                        ) : null}
                      </SummaryRow>
                    </dl>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {state.status === 'loading'
                        ? t('customers.deals.timeline.drawer.loading', 'Loading deal…')
                        : t('customers.deals.timeline.drawer.activity.unavailable', 'Activity details are unavailable.')}
                    </p>
                  )}
                </DrawerSection>

                {canWrite ? (
                  <DrawerSection
                    id="timeline-drawer-close-deal"
                    title={t('customers.deals.timeline.drawer.section.closeDeal', 'Close deal')}
                  >
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => void closure.handleWon()}>
                        <Trophy className="size-4" aria-hidden="true" />
                        {t('customers.deals.timeline.drawer.action.markWon', 'Mark won')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={closure.openLostDialog}>
                        <XCircle className="size-4" aria-hidden="true" />
                        {t('customers.deals.timeline.drawer.action.markLost', 'Mark lost')}
                      </Button>
                    </div>
                  </DrawerSection>
                ) : null}
              </div>
            )}
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {deal ? (
        <>
          <ChangeCloseDateDialog
            open={closeDateDialogOpen}
            currentDate={deal.expectedCloseAt}
            onCancel={() => setCloseDateDialogOpen(false)}
            onSubmit={handleReschedule}
          />
          <ChangeStageDialog
            open={stageDialogOpen}
            selectedCount={1}
            pipelineName={deal.pipelineName ?? ''}
            stages={otherStages}
            isSubmitting={isStageSaving}
            onClose={() => setStageDialogOpen(false)}
            onConfirm={(stageId) => void handleStageChange(stageId)}
          />
          {followUpEntity && scheduleOpen ? (
            <ScheduleActivityDialog
              open={scheduleOpen}
              onClose={() => setScheduleOpen(false)}
              entityId={followUpEntity.id}
              dealId={deal.id}
              entityType={followUpEntity.kind}
              entityName={followUpEntity.label}
              companyName={deal.primaryCompany?.label ?? null}
              onActivityCreated={() => { void refreshAfterWrite() }}
            />
          ) : null}
          <ConfirmDealLostDialog
            open={closure.lostDialogOpen}
            onClose={closure.closeLostDialog}
            dealTitle={deal.title || untitled}
            dealValue={valueLabel}
            companyName={deal.primaryCompany?.label ?? null}
            onConfirm={closure.handleLostConfirm}
          />
          <DealWonPopup
            open={closure.wonPopupOpen}
            onClose={closure.closeWonPopup}
            dealTitle={deal.title || untitled}
            stats={closure.wonStats}
          />
          <DealLostSummaryDialog
            open={closure.lostPopupOpen}
            onClose={closure.closeLostPopup}
            dealTitle={deal.title || untitled}
            stats={closure.lostStats}
          />
        </>
      ) : null}
    </>
  )
}

export default TimelineDealDrawer
