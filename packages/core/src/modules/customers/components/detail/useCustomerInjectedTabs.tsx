"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { InjectionSpot, useInjectionWidgets, type LoadedInjectionSpotWidget } from '@open-mercato/ui/backend/injection/InjectionSpot'

export type CustomerInjectedTab = {
  id: string
  label: string
  priority: number
  widgets: LoadedInjectionSpotWidget[]
}

export function groupCustomerInjectedTabs(
  widgets: LoadedInjectionSpotWidget[],
  translate: (key: string, fallback: string) => string,
): CustomerInjectedTab[] {
  const groups = new Map<string, CustomerInjectedTab>()
  const seen = new Set<string>()
  for (const widget of widgets) {
    if (seen.has(widget.widgetId) || widget.placement?.kind === 'stack') continue
    seen.add(widget.widgetId)
    const id = widget.placement?.groupId ?? widget.widgetId
    const declaredPriority = widget.placement?.priority ?? widget.module.metadata.priority
    const priority = typeof declaredPriority === 'number' ? declaredPriority : 0
    const group = groups.get(id)
    if (group) {
      group.widgets.push(widget)
      group.priority = Math.max(group.priority, priority)
    } else {
      const label = widget.placement?.groupLabel ?? widget.module.metadata.title ?? id
      groups.set(id, { id, label: translate(label, label), priority, widgets: [widget] })
    }
  }
  return Array.from(groups.values()).sort((left, right) => right.priority - left.priority)
}

export function useCustomerInjectedTabs<TData>({
  spotId,
  context,
  data,
  onDataChange,
  nativeTabIds,
}: {
  spotId: string
  context: unknown
  data: TData
  onDataChange?: (data: TData) => void
  nativeTabIds: readonly string[]
}) {
  const t = useT()
  const { widgets, loading } = useInjectionWidgets(spotId, { context, triggerOnLoad: true })
  const groups = React.useMemo(() => groupCustomerInjectedTabs(widgets, t), [widgets, t])
  const injectedTabs = React.useMemo(
    () => groups.filter((group) => !nativeTabIds.includes(group.id)),
    [groups, nativeTabIds],
  )
  const injectedTabMap = React.useMemo(() => new Map(groups.map((group) => [group.id, () => (
    <div className="space-y-4">
      <InjectionSpot spotId={spotId} context={context} data={data} onDataChange={onDataChange} widgetsOverride={group.widgets} />
    </div>
  )])), [groups, spotId, context, data, onDataChange])
  return { injectedTabs, injectedTabMap, loading }
}
