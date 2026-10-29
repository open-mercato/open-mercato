"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'

export type OAuthGrantBannerStatus = 'active' | 'invalidated' | 'unavailable'

export type OAuthGrantReauthBannerProps = {
  status: OAuthGrantBannerStatus | null | undefined
  integrationTitle: string
  reconnectHref: string | null
  canManageCredentials: boolean
  isAccessLoading: boolean
}

export function resolveOAuthGrantReconnectHref(input: {
  integrationId: string
  connectTabId: string | null | undefined
  visibleTabIds: readonly string[]
  canManageCredentials: boolean
}): string | null {
  const connectTabId = input.connectTabId?.trim()
  if (!connectTabId || !input.canManageCredentials || !input.visibleTabIds.includes(connectTabId)) return null
  return `/backend/integrations/${encodeURIComponent(input.integrationId)}?tab=${encodeURIComponent(connectTabId)}`
}

export function OAuthGrantReauthBanner({
  status,
  integrationTitle,
  reconnectHref,
  canManageCredentials,
  isAccessLoading,
}: OAuthGrantReauthBannerProps) {
  const t = useT()
  if (status !== 'invalidated') return null

  const message = t(
    'integrations.detail.oauthGrant.invalidated',
    'Access to {title} was revoked or expired. Reconnect to resume.',
    { title: integrationTitle },
  )
  const showAskAdmin = !isAccessLoading && !canManageCredentials
  const linkHref = !isAccessLoading && canManageCredentials ? reconnectHref : null

  return (
    <Alert
      status="error"
      data-testid="integration-oauth-grant-reauth-banner"
      action={linkHref ? (
        <LinkButton asChild variant="black" underline="always" className="rounded-sm focus-visible:shadow-focus">
          <Link href={linkHref}>{t('integrations.detail.oauthGrant.reconnect', 'Reconnect')}</Link>
        </LinkButton>
      ) : undefined}
    >
      {message}
      {showAskAdmin ? ` ${t('integrations.detail.oauthGrant.askAdmin', 'Ask an administrator to reconnect.')}` : null}
    </Alert>
  )
}
