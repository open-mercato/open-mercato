"use client"
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard, PortalCardHeader } from '@open-mercato/ui/portal/components/PortalCard'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import { usePortalDashboardWidgets } from '@open-mercato/ui/portal/hooks/usePortalDashboardWidgets'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { PortalInjectionSpots } from '@open-mercato/ui/backend/injection/spotIds'

type Props = { params: { orgSlug: string } }

const HIDDEN_WIDGETS_KEY = 'om:portal:dashboard:hidden'

function loadHiddenWidgets(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_WIDGETS_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw))
  } catch {
    return new Set()
  }
}

function saveHiddenWidgets(hidden: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_WIDGETS_KEY, JSON.stringify(Array.from(hidden)))
  } catch {
    // best effort
  }
}

function WidgetIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="5" x="14" y="12" rx="1" /><rect width="7" height="9" x="3" y="16" rx="1" />
    </svg>
  )
}

export default function PortalDashboardPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading } = auth

  const [editing, setEditing] = useState(false)
  const [hiddenWidgets, setHiddenWidgets] = useState<Set<string>>(() => loadHiddenWidgets())

  const { widgets: dashboardWidgets, isLoading: widgetsLoading } = usePortalDashboardWidgets('portal:dashboard:sections' as any)

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/${params.orgSlug}/portal/login`)
    }
  }, [loading, user, router, params.orgSlug])

  const toggleWidget = useCallback((widgetId: string) => {
    setHiddenWidgets((prev) => {
      const next = new Set(prev)
      if (next.has(widgetId)) {
        next.delete(widgetId)
      } else {
        next.add(widgetId)
      }
      saveHiddenWidgets(next)
      return next
    })
  }, [])

  const visibleWidgets = useMemo(
    () => dashboardWidgets.filter((w) => !hiddenWidgets.has(w.metadata.id)),
    [dashboardWidgets, hiddenWidgets],
  )

  const injectionContext = useMemo(
    () => ({ orgSlug: params.orgSlug, user, roles: auth.roles, resolvedFeatures: auth.resolvedFeatures }),
    [params.orgSlug, user, auth.roles, auth.resolvedFeatures],
  )

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>
  }

  if (!user) return null

  return (
    <div className="flex flex-col gap-8">
      <PortalPageHeader
        label={t('portal.dashboard.title', 'Dashboard')}
        title={t('portal.dashboard.welcome', { name: user.displayName })}
        action={
          dashboardWidgets.length > 0 ? (
            <Button
              type="button"
              variant={editing ? 'default' : 'outline'}
              size="sm"
              className="rounded-lg text-[13px]"
              onClick={() => setEditing((prev) => !prev)}
            >
              {editing ? t('portal.dashboard.done', 'Done') : t('portal.dashboard.customize', 'Customize')}
            </Button>
          ) : null
        }
      />

      <InjectionSpot spotId={PortalInjectionSpots.pageBefore('dashboard')} context={injectionContext} />

      {editing && dashboardWidgets.length > 0 ? (
        <PortalCard>
          <PortalCardHeader
            label={t('portal.dashboard.customize', 'Customize')}
            title={t('portal.dashboard.widgets', 'Dashboard Widgets')}
          />
          <div className="flex flex-wrap gap-2">
            {dashboardWidgets.map((widget) => {
              const isHidden = hiddenWidgets.has(widget.metadata.id)
              return (
                <Button key={widget.metadata.id} type="button" variant={isHidden ? 'outline' : 'default'} size="sm" className="rounded-lg text-[13px]" onClick={() => toggleWidget(widget.metadata.id)}>
                  {widget.metadata.title || widget.metadata.id}
                </Button>
              )
            })}
          </div>
        </PortalCard>
      ) : null}

      {visibleWidgets.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visibleWidgets.map((widget) => {
            const WidgetComponent = widget.Widget
            if (!WidgetComponent) return null
            return (
              <PortalCard key={widget.metadata.id}>
                <PortalCardHeader title={widget.metadata.title || widget.metadata.id} />
                <WidgetComponent context={{ orgSlug: params.orgSlug, user, roles: auth.roles, resolvedFeatures: auth.resolvedFeatures }} />
              </PortalCard>
            )
          })}
        </div>
      ) : null}

      {dashboardWidgets.length === 0 && !widgetsLoading ? (
        <PortalEmptyState
          icon={<WidgetIcon className="size-5" />}
          title={t('portal.dashboard.emptyWidgets', 'No dashboard widgets yet')}
          description="Modules can inject widgets into this dashboard via the portal:dashboard:sections injection spot."
        />
      ) : null}

      <InjectionSpot spotId={PortalInjectionSpots.pageAfter('dashboard')} context={injectionContext} />
    </div>
  )
}
