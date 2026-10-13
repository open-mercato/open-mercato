"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import type { XeroConnectionView } from './types'

export type XeroTabState = 'not_configured' | 'not_connected' | 'unavailable' | 'invalidated' | 'account_pending' | 'connected'

const REVOCATION_PENDING_GRACE_MS = 5 * 60 * 1000

export function resolveXeroTabState(connection: XeroConnectionView): XeroTabState {
  const { grant } = connection
  if (grant.connectionState === 'not_configured') return 'not_configured'
  if (grant.connectionState === 'not_connected') return 'not_connected'
  if (grant.connectionState === 'unavailable') return 'unavailable'
  if (grant.connectionState === 'invalidated') return 'invalidated'
  return grant.organisation ? 'connected' : 'account_pending'
}

export function revocationUnconfirmed(connection: XeroConnectionView, now: number = Date.now()): boolean {
  const lastDisconnect = connection.grant.lastDisconnect
  if (!lastDisconnect) return false
  if (lastDisconnect.revocation === 'failed') return true
  return lastDisconnect.revocation === 'pending' && now - Date.parse(lastDisconnect.at) > REVOCATION_PENDING_GRACE_MS
}

export type ConnectionStateActions = {
  connect: () => void
  replaceUnreadable: () => void
  disconnectAnyway: () => void
  openDisconnect: () => void
  openPicker: (scope: 'consent' | 'all') => void
  openCredentials?: () => void
}

type PanelProps = {
  connection: XeroConnectionView
  state: XeroTabState
  canConnect: boolean
  actions: ConnectionStateActions
}

function Message({ status, text }: { status: 'information' | 'warning' | 'error'; text: string }) {
  return (
    <Alert status={status}>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
}

export function ConnectionStatePanel({ connection, state, canConnect, actions }: PanelProps) {
  const t = useT()
  const { grant, canManage } = connection
  const hasGrant = grant.status !== 'none'
  const connectLabel = state === 'not_connected' ? t('sync_xero.tab.connect') : t('sync_xero.tab.reconnect')
  const connectVariant = state === 'not_connected' || state === 'invalidated' ? 'default' : 'outline'

  return (
    <div className="space-y-3">
      {state === 'not_configured' ? <Message status="information" text={t('sync_xero.tab.notConfigured')} /> : null}
      {state === 'not_connected' ? <p className="text-sm">{t('sync_xero.tab.notConnected')}</p> : null}
      {state === 'not_connected' && revocationUnconfirmed(connection) ? (
        <Message status="warning" text={t('sync_xero.tab.revocationUnconfirmed')} />
      ) : null}
      {state === 'unavailable' ? <Message status="error" text={t('sync_xero.tab.unavailable.message')} /> : null}
      {state === 'invalidated' ? <Message status="warning" text={t('sync_xero.tab.invalidated')} /> : null}
      {state === 'account_pending' ? <Message status="information" text={t('sync_xero.tab.accountPending')} /> : null}
      {state === 'connected' && grant.organisation ? (
        <p className="text-sm">{t('sync_xero.tab.connectedTo', { name: grant.organisation.name })}</p>
      ) : null}
      {hasGrant && grant.clientChanged ? <Message status="warning" text={t('sync_xero.tab.clientChanged')} /> : null}
      {hasGrant && grant.missingScopes.length > 0 ? (
        <Message status="warning" text={t('sync_xero.tab.missingScopes', { scopes: grant.missingScopes.join(', ') })} />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {state === 'not_configured' && actions.openCredentials ? (
          <Button type="button" variant="outline" onClick={actions.openCredentials}>
            {t('sync_xero.tab.openCredentials')}
          </Button>
        ) : null}
        {state === 'account_pending' ? (
          <Button type="button" onClick={() => actions.openPicker('consent')} disabled={!canManage}>
            {t('sync_xero.tab.chooseOrganisation')}
          </Button>
        ) : null}
        {state === 'connected' ? (
          <Button type="button" variant="outline" onClick={() => actions.openPicker('all')} disabled={!canManage}>
            {t('sync_xero.tab.changeOrganisation')}
          </Button>
        ) : null}
        {state === 'not_connected' || state === 'invalidated' || state === 'account_pending' || state === 'connected' ? (
          <Button type="button" variant={connectVariant} onClick={actions.connect} disabled={!canConnect}>
            {connectLabel}
          </Button>
        ) : null}
        {state === 'unavailable' && grant.unavailableReason === 'unreadable' ? (
          <Button type="button" variant="destructive-outline" onClick={actions.replaceUnreadable} disabled={!canConnect}>
            {t('sync_xero.tab.unavailable.replace')}
          </Button>
        ) : null}
        {state === 'unavailable' ? (
          <Button type="button" variant="destructive-outline" onClick={actions.disconnectAnyway} disabled={!canManage}>
            {t('sync_xero.disconnect.anyway')}
          </Button>
        ) : null}
        {hasGrant && state !== 'unavailable' ? (
          <Button type="button" variant="destructive-outline" onClick={actions.openDisconnect} disabled={!canManage}>
            {t('sync_xero.disconnect.open')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
