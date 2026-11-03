'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { tillioErrorCopy } from '../../../lib/error-codes'
import type { EnvironmentBlocker } from '../../../lib/pull-readiness'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type OperatorSummary = {
  id: string
  plugin: string
  tenantDomain: string
  stale: boolean
}

type OperatorsResponse = {
  ok: boolean
  environmentReady: boolean
  environmentBlocker: EnvironmentBlocker | null
  tenantSystemId: string | null
  supportedPlugins: string[]
  operators: OperatorSummary[]
  defaultOperatorId: string | null
  envDrift: boolean
}

type AttachResult = {
  ok: boolean
  code?: string
  section?: 'environment' | 'operator'
  operator?: { id: string; plugin: string; tenantDomain: string }
}

type DetachResult = {
  ok: boolean
  code?: string
  section?: 'environment' | 'operator'
  detached?: boolean
  revoked?: boolean
  /** Set when the record survived because the token could not be revoked. */
  canForce?: boolean
}

export default function OperatorsConfigWidget(
  _props: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>,
) {
  const t = useT()
  const attachErrorText = React.useCallback((code: string | undefined) => {
    const copy = tillioErrorCopy(code, 'attach_failed')
    return t(copy.key, copy.fallback)
  }, [t])
  const detachErrorText = React.useCallback((code: string | undefined) => {
    const copy = tillioErrorCopy(code, 'detach_failed')
    return t(copy.key, copy.fallback)
  }, [t])
  const [state, setState] = React.useState<OperatorsResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [keyInput, setKeyInput] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'tillio-operators',
    blockedMessage: t('tillio.operators.blocked', 'Operator change blocked by validation.'),
  })
  const mutationContext = React.useMemo(
    () => ({ providerKey: 'tillio', retryLastMutation }),
    [retryLastMutation],
  )
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiCall<OperatorsResponse>('/api/tillio/operators')
      if (response.ok && response.result) {
        setState(response.result)
      } else {
        setState(null)
        flash(t('tillio.operators.loadFailed', 'Failed to load Tillio operators.'), 'error')
      }
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const attach = React.useCallback(async () => {
    if (pending) return
    const key = keyInput.trim()
    if (!key) {
      flash(t('tillio.operators.keyRequired', 'Enter the Ringostat key first.'), 'error')
      return
    }
    setPending(true)
    try {
      const response = await runMutation({
        context: mutationContext,
        mutationPayload: { providerKey: 'tillio', plugin: 'Ringostat' },
        operation: () =>
          apiCall<AttachResult>('/api/tillio/operators', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ plugin: 'Ringostat', config: { key } }),
          }),
      })
      const body = response.result as AttachResult | undefined
      if (!response.ok) {
        flash(attachErrorText(body?.code), 'error')
        return
      }
      flash(t('tillio.operators.attached', 'Operator attached.'), 'success')
      setKeyInput('')
      await load()
    } finally {
      setPending(false)
    }
  }, [attachErrorText, keyInput, load, mutationContext, pending, runMutation, t])

  const sendDetach = React.useCallback(async (operatorId: string, force: boolean) => {
    const query = force ? '?force=true' : ''
    return runMutation({
      context: mutationContext,
      mutationPayload: { providerKey: 'tillio', force },
      operation: () =>
        apiCall<DetachResult>(`/api/tillio/operators/${encodeURIComponent(operatorId)}${query}`, { method: 'DELETE' }),
    })
  }, [mutationContext, runMutation])

  const detach = React.useCallback(async (operatorId: string) => {
    const confirmed = await confirm({
      title: t('tillio.operators.detachConfirmTitle', 'Detach this operator?'),
      text: t('tillio.operators.detachConfirmText', 'The operator will be removed and its Tillio token revoked. You can attach it again afterwards.'),
      confirmText: t('tillio.operators.detachConfirmAction', 'Detach'),
      cancelText: t('tillio.operators.cancel', 'Cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setPending(true)
    try {
      const response = await sendDetach(operatorId, false)
      const body = response.result as DetachResult | undefined
      if (response.ok) {
        flash(t('tillio.operators.detached', 'Operator detached.'), 'success')
        await load()
        return
      }

      // The token is still live on Tillio's side, so the record stayed. Removing it anyway
      // is a separate, explicit decision — it leaves that token behind with no handle to it.
      if (!body?.canForce) {
        flash(detachErrorText(body?.code), 'error')
        return
      }
      const forceConfirmed = await confirm({
        title: t('tillio.operators.forceDetachTitle', 'Detach without revoking?'),
        text: t('tillio.operators.forceDetachText', 'The Tillio token could not be revoked, so it stays active until you remove it in Tillio. Remove the operator here anyway?'),
        confirmText: t('tillio.operators.forceDetachAction', 'Detach anyway'),
        cancelText: t('tillio.operators.cancel', 'Cancel'),
        variant: 'destructive',
      })
      if (!forceConfirmed) return

      const forced = await sendDetach(operatorId, true)
      if (!forced.ok) {
        flash(t('tillio.operators.detachFailed', 'Could not detach the operator.'), 'error')
        return
      }
      flash(t('tillio.operators.detachedNotRevoked', 'Operator removed. Revoke its token in Tillio manually.'), 'success')
      await load()
    } finally {
      setPending(false)
    }
  }, [confirm, detachErrorText, load, sendDetach, t])

  const copyTenantDomain = React.useCallback(async (tenantDomain: string) => {
    try {
      await navigator.clipboard.writeText(tenantDomain)
      flash(t('tillio.operators.copied', 'Webhook domain copied.'), 'success')
    } catch {
      flash(t('tillio.operators.copyFailed', 'Could not copy to clipboard.'), 'error')
    }
  }, [t])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner />
        {t('tillio.operators.loading', 'Loading operators...')}
      </div>
    )
  }

  if (!state) {
    return (
      <Alert status="error">
        <AlertTitle>{t('tillio.operators.loadFailed', 'Failed to load Tillio operators.')}</AlertTitle>
        <AlertDescription>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {t('tillio.operators.retry', 'Retry')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const operator = state.operators[0] ?? null

  return (
    <div className="grid gap-4">
      {ConfirmDialogElement}

      {!state.environmentReady ? (
        <Alert status="warning">
          <AlertTitle>
            {state.environmentBlocker === 'integration_disabled'
              ? t('tillio.operators.integrationDisabledTitle', 'Integration disabled')
              : t('tillio.operators.envNotReadyTitle', 'Environment not ready')}
          </AlertTitle>
          <AlertDescription>
            {state.environmentBlocker === 'integration_disabled'
              ? t('tillio.errors.integrationDisabled', 'The Tillio integration is disabled. Enable it first.')
              : t('tillio.operators.envNotReadyText', 'Save the Tillio API URL and key in the Credentials tab, then run the health Check before attaching an operator.')}
          </AlertDescription>
        </Alert>
      ) : null}

      {operator && operator.stale ? (
        <Alert status="warning">
          <AlertTitle>{t('tillio.operators.driftTitle', 'Environment changed')}</AlertTitle>
          <AlertDescription>
            {t('tillio.operators.driftText', 'The environment changed after this operator was attached, so its token may be invalid. Detach and attach it again.')}
          </AlertDescription>
        </Alert>
      ) : null}

      {operator ? (
        <div className="grid gap-3 rounded-md border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{operator.plugin}</span>
              {operator.stale ? (
                <StatusBadge variant="warning" dot>{t('tillio.operators.stale', 'Stale')}</StatusBadge>
              ) : (
                <StatusBadge variant="success" dot>{t('tillio.operators.active', 'Active')}</StatusBadge>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void detach(operator.id)} disabled={pending}>
              {t('tillio.operators.detach', 'Detach')}
            </Button>
          </div>
          <div className="grid gap-1.5">
            <Label asChild>
              <span>{t('tillio.operators.webhookDomain', 'Webhook domain (X-Tenant-Domain)')}</span>
            </Label>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-sm">{operator.tenantDomain}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyTenantDomain(operator.tenantDomain)}>
                {t('tillio.operators.copy', 'Copy')}
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              {t('tillio.operators.webhookHint', 'Register this URL in your operator panel so Tillio forwards its webhooks here.')}
            </span>
          </div>
        </div>
      ) : state.environmentReady ? (
        <div className="grid gap-3 rounded-md border border-border p-4">
          <FormField
            label={t('tillio.operators.ringostatKey', 'Ringostat key')}
            description={t('tillio.operators.ringostatKeyHint', 'One operator at a time. Detach the current one before attaching another.')}
          >
            <Input
              type="password"
              autoComplete="off"
              value={keyInput}
              onChange={(event) => setKeyInput(event.target.value)}
              placeholder={t('tillio.operators.ringostatKeyPlaceholder', 'Paste the Ringostat integration key')}
            />
          </FormField>
          <div>
            <Button type="button" onClick={() => void attach()} disabled={pending}>
              {pending
                ? t('tillio.operators.attaching', 'Attaching...')
                : t('tillio.operators.attach', 'Attach operator')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
