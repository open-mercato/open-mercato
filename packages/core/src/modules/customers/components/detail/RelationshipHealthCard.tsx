"use client"

import * as React from 'react'
import { Heart, EyeOff } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { InteractionSummary } from '../formConfig'
import { computeHealthScore, HEALTH_BADGE_CLASSES, HEALTH_ICON_CLASSES } from './healthScoreUtils'

type RelationshipHealthCardProps = {
  interactions: InteractionSummary[]
  onHide?: () => void
}

export function RelationshipHealthCard({ interactions, onHide }: RelationshipHealthCardProps) {
  const t = useT()
  const health = React.useMemo(() => computeHealthScore(interactions), [interactions])

  return (
    <div className="group relative rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Heart className={cn('size-4', HEALTH_ICON_CLASSES[health.variant])} />
          {t('customers.companies.detail.health.title', 'Relationship health')}
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
      <div className="mt-4 flex items-center justify-center">
        <div className="space-y-2 text-center">
          <div className="relative inline-flex items-center justify-center">
            <span className={cn('text-4xl font-bold', HEALTH_ICON_CLASSES[health.variant])}>{health.score}</span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <div>
            <Badge className={cn('text-xs', HEALTH_BADGE_CLASSES[health.variant])}>
              {t(`customers.companies.detail.health.${health.label}`, health.label)}
            </Badge>
          </div>
          {health.lastContactDays !== null && (
            <p className="text-xs text-muted-foreground">
              {t('customers.companies.detail.health.lastContact', 'Last contact')}: {health.lastContactDays === 0
                ? t('customers.health.today', 'today')
                : t('customers.health.daysAgo', '{days} days ago', { days: health.lastContactDays })}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
