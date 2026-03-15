"use client"
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { PortalShell } from '@open-mercato/ui/portal/PortalShell'
import { useTenantContext } from '@open-mercato/ui/portal/hooks/useTenantContext'
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard, PortalCardHeader } from '@open-mercato/ui/portal/components/PortalCard'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import { usePortalDashboardWidgets } from '@open-mercato/ui/portal/hooks/usePortalDashboardWidgets'

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
  const orgSlug = params.orgSlug
  const { organizationName, loading: ctxLoading, error: ctxError } = useTenantContext(orgSlug)
  const { user, roles, resolvedFeatures, loading, logout } = useCustomerAuth(orgSlug)

  const [editing, setEditing] = useState(false)
  const [hiddenWidgets, setHiddenWidgets] = useState<Set<string>>(() => loadHiddenWidgets())

  const { widgets: dashboardWidgets, isLoading: widgetsLoading } = usePortalDashboardWidgets('portal:dashboard:sections' as any)

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/${orgSlug}/portal/login`)
    }
  }, [loading, user, router, orgSlug])

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

  if (ctxLoading || loading) {
    return (
      <PortalShell orgSlug={orgSlug} authenticated>
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      </PortalShell>
    )
  }

  if (ctxError) {
    return (
      <PortalShell orgSlug={orgSlug}>
        <div className="mx-auto w-full max-w-md py-12">
          <Notice variant="error">{t('portal.org.invalid', 'Organization not found.')}</Notice>
        </div>
      </PortalShell>
    )
  }

  if (!user) return null

  return (
    <PortalShell
      orgSlug={orgSlug}
      organizationName={organizationName}
      authenticated
      onLogout={logout}
      enableEventBridge
      userName={user.displayName}
      userEmail={user.email}
    >
      <div className="flex flex-col gap-8">
        {/* Page header */}
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
                {editing
                  ? t('portal.dashboard.done', 'Done')
                  : t('portal.dashboard.customize', 'Customize')}
              </Button>
            ) : null
          }
        />

        {/* Widget toggle panel (edit mode) */}
        {editing && dashboardWidgets.length > 0 ? (
          <PortalCard>
            <PortalCardHeader
              label={t('portal.dashboard.customize', 'Customize')}
              title={t('portal.dashboard.widgets', 'Dashboard Widgets')}
              description="Toggle widgets on or off to customize your dashboard."
            />
            <div className="flex flex-wrap gap-2">
              {dashboardWidgets.map((widget) => {
                const isHidden = hiddenWidgets.has(widget.metadata.id)
                return (
                  <Button
                    key={widget.metadata.id}
                    type="button"
                    variant={isHidden ? 'outline' : 'default'}
                    size="sm"
                    className="rounded-lg text-[13px]"
                    onClick={() => toggleWidget(widget.metadata.id)}
                  >
                    {widget.metadata.title || widget.metadata.id}
                  </Button>
                )
              })}
            </div>
          </PortalCard>
        ) : null}

        {/* Widget grid */}
        {visibleWidgets.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {visibleWidgets.map((widget) => {
              const WidgetComponent = widget.Widget
              if (!WidgetComponent) return null
              return (
                <PortalCard key={widget.metadata.id}>
                  <PortalCardHeader title={widget.metadata.title || widget.metadata.id} />
                  <WidgetComponent context={{ orgSlug, user, roles, resolvedFeatures }} />
                </PortalCard>
              )
            })}
          </div>
        ) : null}

        {/* Empty state */}
        {dashboardWidgets.length === 0 && !widgetsLoading ? (
          <PortalEmptyState
            icon={<WidgetIcon className="size-5" />}
            title={t('portal.dashboard.emptyWidgets', 'No dashboard widgets yet')}
            description="Modules can inject widgets into this dashboard via the portal:dashboard:sections injection spot."
          />
        ) : null}
      </div>
    </PortalShell>
  )
}
