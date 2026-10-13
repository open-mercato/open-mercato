"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { OrganisationPicker, type SaveOrganisationInput } from './OrganisationPicker'
import { navigateToXero } from './navigation'
import { RedirectUriField } from './RedirectUriField'
import { asXeroHttpError, type XeroConnectionView, type XeroTabContext } from './types'
import { useXeroConnection } from './useXeroConnection'
import { useXeroResultFlash } from './useXeroResultFlash'

export type XeroTabState = 'not_configured' | 'not_connected' | 'unavailable' | 'invalidated' | 'account_pending' | 'connected'

const STATE_BADGES: Record<XeroTabState, StatusBadgeVariant> = {
  not_configured: 'neutral',
  not_connected: 'neutral',
  unavailable: 'error',
  invalidated: 'error',
  account_pending: 'warning',
  connected: 'success',
}

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

type PickerState = { open: boolean; scope: 'consent' | 'all' }

export default function XeroTabWidget({ context }: InjectionWidgetComponentProps<XeroTabContext>) {
  const t = useT()
  const { connection, isLoading, hasError, reload } = useXeroConnection()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'sync_xero.xero-tab',
    spotId: context.integrationDetailWidgetSpotId,
  })
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [picker, setPicker] = React.useState<PickerState>({ open: false, scope: 'consent' })
  const [isStarting, setIsStarting] = React.useState(false)
  useXeroResultFlash(reload)

  const mutationContext = React.useCallback(
    (actionId: string) => ({ ...context, retryLastMutation, actionId, operation: 'update' }),
    [context, retryLastMutation],
  )

  const startConnect = React.useCallback(
    async (replaceUnreadable: boolean) => {
      setIsStarting(true)
      try {
        const call = await runMutation({
          operation: () =>
            apiCallOrThrow<{ authorizeUrl: string }>('/api/sync_xero/oauth/initiate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(replaceUnreadable ? { replaceUnreadable: true } : {}),
            }),
          context: mutationContext(replaceUnreadable ? 'replace-unreadable' : 'connect'),
          mutationPayload: { replaceUnreadable },
        })
        if (call.result?.authorizeUrl) navigateToXero(call.result.authorizeUrl)
      } catch (error) {
        flash(asXeroHttpError(error)?.message ?? t('sync_xero.tab.connectFailed'), 'error')
      } finally {
        setIsStarting(false)
      }
    },
    [mutationContext, runMutation, t],
  )

  const confirmReplaceUnreadable = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('sync_xero.tab.unavailable.replaceTitle'),
      text: t('sync_xero.tab.unavailable.replaceText'),
      confirmText: t('sync_xero.tab.unavailable.replace'),
      variant: 'destructive',
    })
    if (confirmed) await startConnect(true)
  }, [confirm, startConnect, t])

  const saveOrganisation = React.useCallback(
    async (input: SaveOrganisationInput) => {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(connection?.grant.revisedAt), () =>
            apiCallOrThrow('/api/sync_xero/organisation', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(input),
            }),
          ),
        context: mutationContext('save-organisation'),
        mutationPayload: input,
      })
    },
    [connection?.grant.revisedAt, mutationContext, runMutation],
  )

  if (isLoading) return <LoadingMessage label={t('sync_xero.tab.loading')} />
  if (hasError || !connection) {
    return (
      <ErrorMessage
        label={t('sync_xero.tab.loadFailed')}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
            {t('sync_xero.tab.retry')}
          </Button>
        }
      />
    )
  }

  const state = resolveXeroTabState(connection)
  const canConnect = connection.canManage && !connection.baseUrlMissing && !isStarting
  const connectLabel = state === 'not_connected' ? t('sync_xero.tab.connect') : t('sync_xero.tab.reconnect')
  const connectButton = (
    <Button type="button" onClick={() => void startConnect(false)} disabled={!canConnect}>
      {connectLabel}
    </Button>
  )

  return (
    <div className="space-y-4" data-testid="sync-xero-tab" data-state={state}>
      <SectionHeader
        title={t('sync_xero.tab.heading')}
        action={<StatusBadge variant={STATE_BADGES[state]} dot>{t(`sync_xero.tab.state.${state}`)}</StatusBadge>}
      />
      <RedirectUriField redirectUri={connection.redirectUri} />
      {connection.baseUrlMissing ? (
        <Alert status="warning">
          <AlertDescription>{t('sync_xero.tab.baseUrlMissing')}</AlertDescription>
        </Alert>
      ) : null}
      {!connection.canManage ? (
        <p className="text-sm text-muted-foreground">{t('sync_xero.tab.readOnly')}</p>
      ) : null}

      {state === 'not_configured' ? (
        <Alert status="information">
          <AlertDescription>{t('sync_xero.tab.notConfigured')}</AlertDescription>
        </Alert>
      ) : null}
      {state === 'not_configured' && context.setActiveTab ? (
        <Button type="button" variant="outline" onClick={() => context.setActiveTab?.('credentials')}>
          {t('sync_xero.tab.openCredentials')}
        </Button>
      ) : null}

      {state === 'not_connected' ? (
        <div className="space-y-3">
          <p className="text-sm">{t('sync_xero.tab.notConnected')}</p>
          {revocationUnconfirmed(connection) ? (
            <Alert status="warning">
              <AlertDescription>{t('sync_xero.tab.revocationUnconfirmed')}</AlertDescription>
            </Alert>
          ) : null}
          {connectButton}
        </div>
      ) : null}

      {state === 'unavailable' ? (
        <div className="space-y-3">
          <Alert status="error">
            <AlertDescription>{t('sync_xero.tab.unavailable.message')}</AlertDescription>
          </Alert>
          {connection.grant.unavailableReason === 'unreadable' && connection.canManage ? (
            <Button type="button" variant="destructive-outline" onClick={() => void confirmReplaceUnreadable()} disabled={!canConnect}>
              {t('sync_xero.tab.unavailable.replace')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {state === 'invalidated' ? (
        <div className="space-y-3">
          <Alert status="warning">
            <AlertDescription>{t('sync_xero.tab.invalidated')}</AlertDescription>
          </Alert>
          {connectButton}
        </div>
      ) : null}

      {state === 'account_pending' ? (
        <div className="space-y-3">
          <Alert status="information">
            <AlertDescription>{t('sync_xero.tab.accountPending')}</AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setPicker({ open: true, scope: 'consent' })} disabled={!connection.canManage}>
              {t('sync_xero.tab.chooseOrganisation')}
            </Button>
            <Button type="button" variant="outline" onClick={() => void startConnect(false)} disabled={!canConnect}>
              {t('sync_xero.tab.reconnect')}
            </Button>
          </div>
        </div>
      ) : null}

      {state === 'connected' && connection.grant.organisation ? (
        <div className="space-y-3">
          <p className="text-sm">{t('sync_xero.tab.connectedTo', { name: connection.grant.organisation.name })}</p>
          {connection.grant.clientChanged ? (
            <Alert status="warning">
              <AlertDescription>{t('sync_xero.tab.clientChanged')}</AlertDescription>
            </Alert>
          ) : null}
          {connection.grant.missingScopes.length > 0 ? (
            <Alert status="warning">
              <AlertDescription>{t('sync_xero.tab.missingScopes', { scopes: connection.grant.missingScopes.join(', ') })}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setPicker({ open: true, scope: 'all' })} disabled={!connection.canManage}>
              {t('sync_xero.tab.changeOrganisation')}
            </Button>
            <Button type="button" variant="outline" onClick={() => void startConnect(false)} disabled={!canConnect}>
              {t('sync_xero.tab.reconnect')}
            </Button>
          </div>
        </div>
      ) : null}

      <OrganisationPicker
        open={picker.open}
        scope={picker.scope}
        onOpenChange={(open) => setPicker((current) => ({ ...current, open }))}
        save={saveOrganisation}
        onSaved={reload}
      />
      {ConfirmDialogElement}
    </div>
  )
}
