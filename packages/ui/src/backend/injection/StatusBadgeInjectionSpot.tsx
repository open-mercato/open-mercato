"use client"

import * as React from 'react'
import type { InjectionSpotId, InjectionStatusBadgeWidget, StatusBadgeContext } from '@open-mercato/shared/modules/widgets/injection'
import { useInjectionDataWidgets } from './useInjectionDataWidgets'
import { StatusBadgeRenderer } from './StatusBadgeRenderer'

type StatusBadgeInjectionSpotProps = {
  spotId: InjectionSpotId
  context: Partial<StatusBadgeContext> & Record<string, unknown>
}

function isStatusBadgeWidget(widget: { module?: unknown } & Record<string, unknown>): widget is { module: InjectionStatusBadgeWidget } & Record<string, unknown> {
  const mod = (widget as any).module ?? widget
  return mod && typeof mod === 'object' && 'kind' in mod && mod.kind === 'status-badge' && 'badge' in mod
}

/**
 * Renders status badge data widgets for a given injection spot.
 * Filters loaded data widgets to only those with `kind: 'status-badge'`.
 */
export function StatusBadgeInjectionSpot({ spotId, context }: StatusBadgeInjectionSpotProps) {
  const { widgets, isLoading } = useInjectionDataWidgets(spotId)

  if (isLoading || widgets.length === 0) return null

  const badgeWidgets = widgets.filter(isStatusBadgeWidget)
  if (badgeWidgets.length === 0) return null

  const badgeContext: StatusBadgeContext = {
    organizationId: (context.organizationId as string) ?? '',
    tenantId: (context.tenantId as string) ?? '',
    userId: (context.userId as string) ?? '',
  }

  return (
    <div className="flex flex-col gap-1">
      {badgeWidgets.map((widget) => {
        const mod = (widget as any).module ?? widget
        return (
          <StatusBadgeRenderer
            key={mod.metadata?.id ?? (widget as any).key}
            widget={mod as InjectionStatusBadgeWidget}
            context={badgeContext}
          />
        )
      })}
    </div>
  )
}
