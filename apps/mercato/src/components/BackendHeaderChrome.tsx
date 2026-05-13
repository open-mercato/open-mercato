'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import * as React from 'react'
import { MoreHorizontal, PlugZap, Settings, Mail } from 'lucide-react'
import { hasFeature } from '@open-mercato/shared/security/features'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { IntegrationsButton } from '@open-mercato/ui/backend/IntegrationsButton'
import { ProfileDropdown } from '@open-mercato/ui/backend/ProfileDropdown'
import { SettingsButton } from '@open-mercato/ui/backend/SettingsButton'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AiAssistantShellIntegration } from '@/components/AiAssistantShellIntegration'

const LazyAiChatHeaderButton = dynamic(
  () => import('@open-mercato/ai-assistant/frontend').then((module) => module.AiChatHeaderButton),
  { ssr: false, loading: () => null },
)
const LazyTopbarSearchInline = dynamic(
  () => import('@open-mercato/search/modules/search/frontend').then((module) => module.TopbarSearchInline),
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
  tenantId: string | null
  organizationId: string | null
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

type MobileMoreItem = {
  id: string
  href: string
  icon: React.ReactNode
  label: string
}

function MobileMoreMenu({ items }: { items: MobileMoreItem[] }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  if (items.length === 0) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('appShell.moreActions', 'More actions')}
          title={t('appShell.moreActions', 'More actions')}
        >
          <MoreHorizontal className="size-4" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[220px] p-1">
        <div className="flex flex-col">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-sm px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/60 focus:outline-none focus-visible:bg-muted/60"
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                {item.icon}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function BackendHeaderChrome({
  email,
  embeddingConfigured,
  missingConfigMessage,
  tenantId,
  organizationId,
}: BackendHeaderChromeProps) {
  const t = useT()
  const { payload, isReady } = useBackendChrome()
  const grantedFeatures = payload?.grantedFeatures ?? []
  const showIntegrationsButton = React.useMemo(
    () => hasVisibleRoute(payload?.groups, '/backend/integrations'),
    [payload?.groups],
  )
  const showAiAssistant = React.useMemo(
    () => hasFeature(grantedFeatures, 'ai_assistant.view'),
    [grantedFeatures],
  )
  const showSearch = React.useMemo(
    () => hasFeature(grantedFeatures, 'search.global'),
    [grantedFeatures],
  )
  const showMessages = React.useMemo(
    () => hasVisibleRoute(payload?.groups, '/backend/messages'),
    [payload?.groups],
  )
  const showNotifications = React.useMemo(
    () => hasFeature(grantedFeatures, 'notifications.view'),
    [grantedFeatures],
  )

  const mobileMoreItems = React.useMemo<MobileMoreItem[]>(() => {
    const items: MobileMoreItem[] = []
    if (showIntegrationsButton) {
      items.push({
        id: 'integrations',
        href: '/backend/integrations',
        icon: <PlugZap className="size-4" aria-hidden="true" />,
        label: t('integrations.nav.title', 'Integrations'),
      })
    }
    items.push({
      id: 'settings',
      href: '/backend/settings',
      icon: <Settings className="size-4" aria-hidden="true" />,
      label: t('backend.nav.settings', 'Settings'),
    })
    if (isReady && showMessages) {
      items.push({
        id: 'messages',
        href: '/backend/messages',
        icon: <Mail className="size-4" aria-hidden="true" />,
        label: t('messages.nav.inbox', 'Messages'),
      })
    }
    return items
  }, [showIntegrationsButton, isReady, showMessages, t])

  return (
    <>
      {isReady && showAiAssistant ? (
        <AiAssistantShellIntegration tenantId={tenantId} organizationId={organizationId}>
          <LazyAiChatHeaderButton />
        </AiAssistantShellIntegration>
      ) : null}
      {isReady && showSearch ? (
        <LazyTopbarSearchInline
          embeddingConfigured={embeddingConfigured}
          missingConfigMessage={missingConfigMessage}
        />
      ) : null}
      {isReady ? <LazyOrganizationSwitcher /> : null}

      {/* Secondary actions — inline on md+, grouped under a More button on <md */}
      {showIntegrationsButton ? (
        <span className="hidden md:contents">
          <IntegrationsButton />
        </span>
      ) : null}
      <span className="hidden md:contents">
        <SettingsButton />
      </span>
      {isReady && showMessages ? (
        <span className="hidden md:contents">
          <LazyMessagesIcon />
        </span>
      ) : null}
      <span className="md:hidden">
        <MobileMoreMenu items={mobileMoreItems} />
      </span>

      {isReady && showNotifications ? <LazyNotificationBellWrapper /> : null}
      <ProfileDropdown email={email} />
    </>
  )
}
