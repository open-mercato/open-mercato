"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { UseConfirmDialogReturn } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, withScopedApiRequestHeaders, type ApiCallResult } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { asXeroHttpError } from './types'

type DisconnectStep = 'healthCheck' | 'disable' | 'removeClientCredentials'

export type XeroDisconnectResponse = {
  erased: boolean
  revocation: string | null
  failureReason: string | null
  steps: Record<DisconnectStep, 'ok' | 'failed' | 'skipped'>
}

type DisconnectBody = { force?: boolean; removeClientCredentials: boolean }

type UseXeroDisconnectInput = {
  revisedAt: string | null
  confirm: UseConfirmDialogReturn['confirm']
  run: (body: DisconnectBody, operation: () => Promise<ApiCallResult<XeroDisconnectResponse>>) => Promise<ApiCallResult<XeroDisconnectResponse>>
  onDone: () => Promise<void>
}

export function useXeroDisconnect({ revisedAt, confirm, run, onDone }: UseXeroDisconnectInput) {
  const t = useT()
  const [isOpen, setOpen] = React.useState(false)
  const [isWorking, setWorking] = React.useState(false)

  const post = React.useCallback(
    (body: DisconnectBody) =>
      run(body, () =>
        withScopedApiRequestHeaders(buildOptimisticLockHeader(body.force ? null : revisedAt), () =>
          apiCallOrThrow<XeroDisconnectResponse>('/api/sync_xero/disconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        ),
      ),
    [revisedAt, run],
  )

  const report = React.useCallback(
    (result: XeroDisconnectResponse | null) => {
      if (!result?.erased) {
        flash(t('sync_xero.disconnect.notConnected'), 'info')
        return
      }
      if (result.revocation === 'confirmed') flash(t('sync_xero.disconnect.done'), 'success')
      else if (result.revocation === 'failed') flash(t('sync_xero.disconnect.revocationFailed'), 'warning')
      else flash(t('sync_xero.disconnect.doneWithoutRevoke'), 'success')
      const failed = (Object.keys(result.steps) as DisconnectStep[]).filter((step) => result.steps[step] === 'failed')
      if (failed.length > 0) {
        flash(t('sync_xero.disconnect.stepsFailed', { steps: failed.map((step) => t(`sync_xero.disconnect.step.${step}`)).join(', ') }), 'warning')
      }
      if (result.steps.disable === 'skipped') flash(t('sync_xero.disconnect.disableSkipped'), 'warning')
    },
    [t],
  )

  const disconnectAnyway = React.useCallback(
    async (removeClientCredentials = false) => {
      const confirmed = await confirm({
        title: t('sync_xero.disconnect.anywayTitle'),
        text: t('sync_xero.disconnect.anywayText'),
        confirmText: t('sync_xero.disconnect.anyway'),
        variant: 'destructive',
      })
      if (!confirmed) return
      setWorking(true)
      try {
        report((await post({ force: true, removeClientCredentials })).result)
        await onDone()
      } catch (error) {
        flash(asXeroHttpError(error)?.message ?? t('sync_xero.disconnect.failed'), 'error')
      } finally {
        setWorking(false)
      }
    },
    [confirm, onDone, post, report, t],
  )

  const disconnect = React.useCallback(
    async ({ removeClientCredentials }: { removeClientCredentials: boolean }) => {
      setWorking(true)
      let unreadable = false
      try {
        report((await post({ removeClientCredentials })).result)
        setOpen(false)
        await onDone()
      } catch (error) {
        const failure = asXeroHttpError(error)
        if (failure?.code === 'disconnect_tokens_unreadable') {
          unreadable = true
          setOpen(false)
        } else if (failure?.code === 'optimistic_lock_conflict') {
          setOpen(false)
          await onDone()
        } else {
          flash(failure?.message ?? t('sync_xero.disconnect.failed'), 'error')
        }
      } finally {
        setWorking(false)
      }
      if (unreadable) await disconnectAnyway(removeClientCredentials)
    },
    [disconnectAnyway, onDone, post, report, t],
  )

  return { isOpen, setOpen, isWorking, disconnect, disconnectAnyway }
}
