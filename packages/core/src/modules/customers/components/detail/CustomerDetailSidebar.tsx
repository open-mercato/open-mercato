"use client"

import * as React from 'react'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'

export function CustomerDetailSidebar<TData>({ spotId, context, data, onDataChange, disabled, children }: {
  spotId: string
  context: unknown
  data: TData
  onDataChange?: (data: TData) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  const { widgets } = useInjectionWidgets(spotId, { context, triggerOnLoad: true })
  const sidebarRef = React.useRef<HTMLElement>(null)
  const [hasContent, setHasContent] = React.useState(false)
  React.useLayoutEffect(() => {
    const sidebar = sidebarRef.current
    if (!sidebar) {
      setHasContent(false)
      return
    }
    const update = () => setHasContent(Array.from(sidebar.childNodes).some((node) => (
      node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()))
    )))
    update()
    const observer = new MutationObserver(update)
    observer.observe(sidebar, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [widgets, data])
  return (
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row" data-customer-detail-layout>
      <div className="min-w-0 flex-1">{children}</div>
      {widgets.length ? (
        <aside ref={sidebarRef} className={hasContent ? 'w-full space-y-4 lg:w-80 lg:shrink-0' : 'hidden'} data-customer-detail-sidebar={spotId}>
          <InjectionSpot spotId={spotId} context={context} data={data} onDataChange={onDataChange} disabled={disabled} widgetsOverride={widgets} />
        </aside>
      ) : null}
    </div>
  )
}
