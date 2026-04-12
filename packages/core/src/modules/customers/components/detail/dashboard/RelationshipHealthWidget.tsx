"use client"

import * as React from 'react'
import { Heart } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '@open-mercato/ui/primitives/badge'
import type { HealthScore } from '../healthScoreUtils'

type TranslateFnWithParams = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export function RelationshipHealthWidget({ health, t }: { health: HealthScore; t: TranslateFnWithParams }) {
  const colorClasses = {
    emerald: 'text-emerald-500',
    amber: 'text-amber-500',
    red: 'text-red-500',
  }
  const bgClasses = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }
  return (
    <div className="rounded-lg border bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Heart className={cn('size-4', colorClasses[health.variant])} />
        {t('customers.companies.dashboard.relationshipHealth', 'Relationship health')}
      </h3>
      <div className="mt-4 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="relative inline-flex items-center justify-center">
            <span className={cn('text-4xl font-bold', colorClasses[health.variant])}>{health.score}</span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <div>
            <Badge className={cn('text-xs', bgClasses[health.variant])}>
              {t(`customers.health.${health.label}`, health.label)}
            </Badge>
          </div>
          {health.lastContactDays !== null && (
            <p className="text-[10px] text-muted-foreground">
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
