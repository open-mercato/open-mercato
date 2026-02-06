'use client'
import * as React from 'react'
import { usePathname } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '../utils/apiCall'
import { SectionPage } from '../section-page'
import type { SectionNavGroup } from '../section-page'

type FeatureCheckResponse = { ok?: boolean; granted?: string[] }

export type SettingsPageWrapperProps = {
  sections: SectionNavGroup[]
  requiredFeatures: string[]
  children: React.ReactNode
}

export function SettingsPageWrapper({
  sections,
  requiredFeatures,
  children,
}: SettingsPageWrapperProps) {
  const t = useT()
  const pathname = usePathname()
  const [userFeatures, setUserFeatures] = React.useState<Set<string> | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function loadFeatures() {
      if (requiredFeatures.length === 0) {
        setUserFeatures(new Set())
        setLoading(false)
        return
      }
      try {
        const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: requiredFeatures }),
        })
        if (cancelled) return
        if (call.ok && Array.isArray(call.result?.granted)) {
          setUserFeatures(new Set(call.result.granted))
        } else {
          setUserFeatures(new Set())
        }
      } catch {
        if (!cancelled) setUserFeatures(new Set())
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadFeatures()
    return () => {
      cancelled = true
    }
  }, [requiredFeatures])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t('common.loading', 'Loading...')}</div>
      </div>
    )
  }

  return (
    <SectionPage
      title="Settings"
      titleKey="backend.nav.settings"
      sections={sections}
      activePath={pathname ?? '/backend/settings'}
      userFeatures={userFeatures}
    >
      {children}
    </SectionPage>
  )
}
