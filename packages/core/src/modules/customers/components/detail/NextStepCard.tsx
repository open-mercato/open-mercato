"use client"

import * as React from 'react'
import { CalendarClock, Phone, FileText, EyeOff } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@open-mercato/ui/primitives/tooltip'

type NextStepCardProps = {
  nextInteractionAt?: string | null
  nextInteractionName?: string | null
  onHide?: () => void
}

export function NextStepCard({ nextInteractionAt, nextInteractionName, onHide }: NextStepCardProps) {
  const t = useT()

  const daysUntil = React.useMemo(() => {
    if (!nextInteractionAt) return null
    const diff = new Date(nextInteractionAt).getTime() - Date.now()
    return Math.ceil(diff / 86_400_000)
  }, [nextInteractionAt])

  if (!nextInteractionAt) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="size-4" />
          {t('customers.companies.detail.nextStep.title', 'Next Step')}
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('customers.companies.detail.nextStep.none', 'No upcoming interactions scheduled')}
        </p>
      </div>
    )
  }

  const isOverdue = daysUntil !== null && daysUntil < 0
  const countdownText = daysUntil !== null
    ? daysUntil === 0
      ? t('customers.companies.detail.nextStep.today', 'today')
      : daysUntil > 0
        ? t('customers.companies.detail.nextStep.in', 'in {days} days', { days: daysUntil })
        : t('customers.companies.detail.nextStep.overdue', '{days} days overdue', { days: Math.abs(daysUntil) })
    : null

  return (
    <div className="group relative rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="size-4" />
          {t('customers.companies.detail.nextStep.title', 'Next Step')}
        </h3>
        {onHide && (
          <IconButton
            type="button"
            variant="ghost"
            size="xs"
            onClick={onHide}
            className="opacity-0 transition-opacity group-hover:opacity-60"
            aria-label={t('customers.companies.dashboard.hideTile', 'Hide tile')}
          >
            <EyeOff className="size-3.5" />
          </IconButton>
        )}
      </div>

      <div className="mt-3">
        <p className="font-semibold text-foreground">
          {nextInteractionName || t('customers.companies.detail.nextStep.untitled', 'Scheduled interaction')}
        </p>
        {countdownText && (
          <p className={cn('mt-1 text-sm', isOverdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
            {countdownText}
          </p>
        )}
      </div>

      {/* Quick action buttons (disabled stubs) */}
      <div className="mt-3 flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled>
              <Phone className="mr-1 size-3" />
              {t('customers.companies.detail.nextStep.call', 'Call')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('customers.ai.comingSoon', 'Coming soon')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled>
              <FileText className="mr-1 size-3" />
              {t('customers.companies.detail.nextStep.proposal', 'Proposal')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('customers.ai.comingSoon', 'Coming soon')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
