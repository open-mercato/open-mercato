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
import { ConnectionStatePanel, resolveXeroTabState, type XeroTabState } from './ConnectionStatePanel'
import { DisconnectDialog } from './DisconnectDialog'
import { navigateToXero } from './navigation'
import { OrganisationPicker, type SaveOrganisationInput } from './OrganisationPicker'
import { RedirectUriField } from './RedirectUriField'
import { asXeroHttpError, type XeroTabContext } from './types'
import { useXeroConnection } from './useXeroConnection'
import { useXeroDisconnect } from './useXeroDisconnect'
import { useXeroResultFlash } from './useXeroResultFlash'

const STATE_BADGES: Record<XeroTabState, StatusBadgeVariant> = {
  not_configured: 'neutral',
  not_connected: 'neutral',
  unavailable: 'error',
  invalidated: 'error',
  account_pending: 'warning',
  connected: 'success',
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
    (actionId: string, operation: 'update' | 'delete' = 'update') => ({ ...context, retryLastMutation, actionId, operation }),
    [context, retryLastMutation],
  )
  const refreshAll = React.useCallback(async () => {
    await reload()
    await context.refreshDetail?.()
  }, [context, reload])

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

  const disconnect = useXeroDisconnect({
    revisedAt: connection?.grant.revisedAt ?? null,
    confirm,
    run: (body, operation) => runMutation({ operation, context: mutationContext('disconnect', 'delete'), mutationPayload: body }),
    onDone: refreshAll,
  })

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

  return (
    <div className="space-y-4" data-testid="sync-xero-tab" data-state={state}>
      <SectionHeader
        title={t('sync_xero.tab.heading')}
        action={<StatusBadge variant={STATE_BADGES[state]} dot>{t(`sync_xero.tab.state.${state}`)}</StatusBadge>}
      />
      {connection.seamActive ? (
        <Alert status="feature">
          <AlertDescription>{t('sync_xero.tab.seamNotice')}</AlertDescription>
        </Alert>
      ) : null}
      <RedirectUriField redirectUri={connection.redirectUri} />
      {connection.baseUrlMissing ? (
        <Alert status="warning">
          <AlertDescription>{t('sync_xero.tab.baseUrlMissing')}</AlertDescription>
        </Alert>
      ) : null}
      {!connection.canManage ? <p className="text-sm text-muted-foreground">{t('sync_xero.tab.readOnly')}</p> : null}
      <ConnectionStatePanel
        connection={connection}
        state={state}
        canConnect={canConnect}
        actions={{
          connect: () => void startConnect(false),
          replaceUnreadable: () => void confirmReplaceUnreadable(),
          disconnectAnyway: () => void disconnect.disconnectAnyway(),
          openDisconnect: () => disconnect.setOpen(true),
          openPicker: (scope) => setPicker({ open: true, scope }),
          openCredentials: context.setActiveTab ? () => context.setActiveTab?.('credentials') : undefined,
        }}
      />
      <OrganisationPicker
        open={picker.open}
        scope={picker.scope}
        onOpenChange={(open) => setPicker((current) => ({ ...current, open }))}
        save={saveOrganisation}
        onSaved={reload}
      />
      <DisconnectDialog
        open={disconnect.isOpen}
        onOpenChange={disconnect.setOpen}
        selectedOrganisationId={connection.grant.organisation?.id ?? null}
        isWorking={disconnect.isWorking}
        onConfirm={disconnect.disconnect}
      />
      {ConfirmDialogElement}
    </div>
  )
}
