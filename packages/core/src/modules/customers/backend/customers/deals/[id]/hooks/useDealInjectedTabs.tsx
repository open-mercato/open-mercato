import * as React from 'react'
import { useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import type { DealDetailPayload } from './types'

type InjectedTab = {
  id: string
  label: string
  priority: number
  render: () => React.ReactNode
}

type UseDealInjectedTabsOptions = {
  injectionContext: unknown
  data: DealDetailPayload | null
  setData: React.Dispatch<React.SetStateAction<DealDetailPayload | null>>
}

type UseDealInjectedTabsResult = {
  injectedTabs: InjectedTab[]
  injectedTabMap: Map<string, () => React.ReactNode>
}

export function useDealInjectedTabs({
  injectionContext,
  data,
  setData,
}: UseDealInjectedTabsOptions): UseDealInjectedTabsResult {
  const { widgets: injectedTabWidgets } = useInjectionWidgets('detail:customers.deal:tabs', {
    context: injectionContext,
    triggerOnLoad: true,
  })

  const injectedTabs = React.useMemo<InjectedTab[]>(
    () =>
      (injectedTabWidgets ?? [])
        .filter((widget) => (widget.placement?.kind ?? 'tab') === 'tab')
        .map((widget) => {
          const tabId = widget.placement?.groupId ?? widget.widgetId
          const label = widget.placement?.groupLabel ?? widget.module.metadata.title ?? tabId
          const priority = typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0
          const render = () => (
            <widget.module.Widget
              context={injectionContext}
              data={data}
              onDataChange={(next: unknown) => setData(next as DealDetailPayload)}
            />
          )
          return { id: tabId, label, priority, render }
        })
        .sort((left, right) => right.priority - left.priority),
    [data, injectedTabWidgets, injectionContext, setData],
  )

  const injectedTabMap = React.useMemo(
    () => new Map(injectedTabs.map((tab) => [tab.id, tab.render])),
    [injectedTabs],
  )

  return { injectedTabs, injectedTabMap }
}
