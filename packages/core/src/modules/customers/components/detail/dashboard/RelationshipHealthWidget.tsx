"use client"

import * as React from 'react'
import { Heart } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { HEALTH_BADGE_CLASSES, HEALTH_ICON_CLASSES, type HealthScore } from '../healthScoreUtils'

type TranslateFnWithParams = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export function RelationshipHealthWidget({ health, t }: { health: HealthScore; t: TranslateFnWithParams }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Heart className={cn('size-4', HEALTH_ICON_CLASSES[health.variant])} />
        {t('customers.companies.dashboard.relationshipHealth', 'Relationship health')}
      </h3>
      <div className="mt-4 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="relative inline-flex items-center justify-center">
            <span className={cn('text-4xl font-bold', HEALTH_ICON_CLASSES[health.variant])}>{health.score}</span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <div>
            <Badge className={cn('text-xs', HEALTH_BADGE_CLASSES[health.variant])}>
              {t(`customers.health.${health.label}`, health.label)}
            </Badge>
          </div>
          {health.lastContactDays !== null && (
            <p className="text-xs text-muted-foreground">
              {t('customers.health.lastContact', 'Last contact')}: {health.lastContactDays === 0
                ? t('customers.health.today', 'today')
                : t('customers.health.daysAgo', '{{days}} days ago', { days: health.lastContactDays })}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
