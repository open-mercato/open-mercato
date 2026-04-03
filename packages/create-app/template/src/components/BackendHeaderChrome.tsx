'use client'

import dynamic from 'next/dynamic'
import * as React from 'react'
import { IntegrationsButton } from '@open-mercato/ui/backend/IntegrationsButton'
import { ProfileDropdown } from '@open-mercato/ui/backend/ProfileDropdown'
import { SettingsButton } from '@open-mercato/ui/backend/SettingsButton'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'

const LazyAiChatHeaderButton = dynamic(
  () => import('@open-mercato/ai-assistant/frontend').then((module) => module.AiChatHeaderButton),
  { ssr: false, loading: () => null },
)
const LazyGlobalSearchDialog = dynamic(
  () => import('@open-mercato/search/modules/search/frontend').then((module) => module.GlobalSearchDialog),
  { ssr: false, loading: () => null },
)
const LazyOrganizationSwitcher = dynamic(() => import('@/components/OrganizationSwitcher'), {
  ssr: false,
  loading: () => null,
})
const LazyNotificationBellWrapper = dynamic(
  () => import('@/components/NotificationBellWrapper').then((module) => module.NotificationBellWrapper),
  { ssr: false, loading: () => null },
)
const LazyMessagesIcon = dynamic(
  () => import('@open-mercato/ui/backend/messages').then((module) => module.MessagesIcon),
  { ssr: false, loading: () => null },
)

type BackendHeaderChromeProps = {
  email?: string
  embeddingConfigured: boolean
  missingConfigMessage: string
}

function hasVisibleRoute(groups: Array<{ items?: Array<{ href: string; hidden?: boolean; enabled?: boolean; children?: unknown[] }> }> | undefined, href: string): boolean {
  if (!groups) return false
  for (const group of groups) {
    for (const item of group.items ?? []) {
      if (item.href === href && item.hidden !== true && item.enabled !== false) return true
      const children = Array.isArray(item.children) ? item.children as Array<{ href: string; hidden?: boolean; enabled?: boolean; children?: unknown[] }> : []
      if (hasVisibleRoute([{ items: children }], href)) return true
    }
  }
  return false
}

export function BackendHeaderChrome({ email, embeddingConfigured, missingConfigMessage }: BackendHeaderChromeProps) {
  const { payload, isReady } = useBackendChrome()
  const showIntegrationsButton = React.useMemo(
    () => hasVisibleRoute(payload?.groups, '/backend/integrations'),
    [payload?.groups],
  )

  return (
    <>
      {isReady ? <LazyAiChatHeaderButton /> : null}
      {isReady ? (
        <LazyGlobalSearchDialog
          embeddingConfigured={embeddingConfigured}
          missingConfigMessage={missingConfigMessage}
        />
      ) : null}
      <div className="hidden lg:contents">
        {isReady ? <LazyOrganizationSwitcher /> : null}
      </div>
      {showIntegrationsButton ? <IntegrationsButton /> : null}
      <SettingsButton />
      <ProfileDropdown email={email} />
      {isReady ? <LazyNotificationBellWrapper /> : null}
      {isReady ? <LazyMessagesIcon /> : null}
    </>
  )
}
