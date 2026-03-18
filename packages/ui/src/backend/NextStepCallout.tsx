"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Progress } from '@open-mercato/ui/primitives/progress'

type NextStepCalloutStep = {
  id: string
  label: React.ReactNode
  state?: 'pending' | 'active' | 'completed'
}

type NextStepCalloutStatusTone = 'default' | 'info' | 'success' | 'warning' | 'danger' | 'muted'

type NextStepCalloutStatus = {
  tone?: NextStepCalloutStatusTone
  icon?: React.ReactNode
  label: React.ReactNode
  badge?: React.ReactNode
  progressValue?: number | null
  progressDescription?: React.ReactNode
  errorMessage?: React.ReactNode
}

type NextStepCalloutProps = {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  steps?: NextStepCalloutStep[]
  actionLabel: React.ReactNode
  actionIcon?: React.ReactNode
  onAction?: () => void
  disabled?: boolean
  disabledMessage?: React.ReactNode
  busy?: boolean
  status?: NextStepCalloutStatus | null
  className?: string
}

const STEP_STYLES: Record<NonNullable<NextStepCalloutStep['state']>, string> = {
  pending: '',
  active: 'border-primary/40 bg-primary/10 text-primary',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
}

const STATUS_STYLES: Record<NextStepCalloutStatusTone, string> = {
  default: 'border-border bg-background/70 text-foreground',
  info: 'border-primary/20 bg-primary/5 text-primary',
  success: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200',
  warning: 'border-amber-500/20 bg-amber-500/5 text-amber-200',
  danger: 'border-destructive/20 bg-destructive/5 text-destructive',
  muted: 'border-zinc-500/20 bg-zinc-500/5 text-zinc-200',
}

export function NextStepCallout({
  icon,
  title,
  description,
  steps,
  actionLabel,
  actionIcon,
  onAction,
  disabled = false,
  disabledMessage,
  busy = false,
  status,
  className,
}: NextStepCalloutProps) {
  return (
    <div className={cn('rounded-xl border border-dashed border-primary/30 bg-primary/5 px-6 py-8', className)}>
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        {icon ? (
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-background text-primary">
            {icon}
          </div>
        ) : null}
        <h4 className="text-lg font-semibold">{title}</h4>
        {description ? (
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        ) : null}
        {steps && steps.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {steps.map((step) => (
              <Badge
                key={step.id}
                variant="outline"
                className={cn(step.state ? STEP_STYLES[step.state] : STEP_STYLES.pending)}
              >
                {step.label}
              </Badge>
            ))}
          </div>
        ) : null}
        <Button
          type="button"
          size="lg"
          className="mt-6 min-w-72"
          onClick={onAction}
          disabled={disabled || busy}
        >
          {actionIcon}
          {actionLabel}
        </Button>
        {disabledMessage ? (
          <p className="mt-3 text-xs text-muted-foreground">{disabledMessage}</p>
        ) : null}
        {status ? (
          <div className={cn('mt-4 w-full rounded-lg border px-4 py-3 text-left', STATUS_STYLES[status.tone ?? 'default'])}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                {status.icon ? <span className="shrink-0">{status.icon}</span> : null}
                <span>{status.label}</span>
              </div>
              {status.badge ? status.badge : null}
            </div>
            {typeof status.progressValue === 'number' ? (
              <Progress value={status.progressValue} className="mt-3 h-2" />
            ) : busy ? (
              <div className="mt-3 h-2 rounded-full bg-secondary" />
            ) : null}
            {status.progressDescription ? (
              <p className="mt-2 text-xs text-muted-foreground">{status.progressDescription}</p>
            ) : null}
            {status.errorMessage ? (
              <p className="mt-2 text-xs text-destructive">{status.errorMessage}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
