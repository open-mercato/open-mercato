'use client'

import * as React from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useProviderChallengeComponent } from './mfa-ui-registry'

export type SudoChallengeMethod = {
  type: string
  label: string
  icon: string
  components?: {
    list?: string
    details?: string
    challenge?: string
  }
}

export type PendingSudoChallenge = {
  sessionId: string
  targetIdentifier: string
  method: 'password' | 'mfa'
  availableMfaMethods: SudoChallengeMethod[]
}

type SudoChallengeModalProps = {
  open: boolean
  challenge: PendingSudoChallenge | null
  onResolve: (result: { sudoToken: string; expiresAt: string } | null) => void
}

type PrepareResponse = {
  clientData?: Record<string, unknown>
}

type VerifyResponse = {
  sudoToken: string
  expiresAt: string
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

export default function SudoChallengeModal({
  open,
  challenge,
  onResolve,
}: SudoChallengeModalProps) {
  const t = useT()
  const [password, setPassword] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [preparedMethods, setPreparedMethods] = React.useState<Record<string, true>>({})
  const [preparedClientData, setPreparedClientData] = React.useState<Record<string, Record<string, unknown> | undefined>>({})
  const [selectedMethod, setSelectedMethod] = React.useState<string>('')
  const [showMoreOptions, setShowMoreOptions] = React.useState(false)

  React.useEffect(() => {
    if (!open || !challenge) return
    setPassword('')
    setError(null)
    setPreparedMethods({})
    setPreparedClientData({})
    setSelectedMethod(challenge.availableMfaMethods[0]?.type ?? '')
    setShowMoreOptions(false)
  }, [challenge, open])

  const prepare = React.useCallback(async (methodType: string) => {
    if (!challenge) return undefined
    const result = await readApiResultOrThrow<PrepareResponse>('/api/security/sudo/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: challenge.sessionId,
        methodType,
      }),
    })
    return result.clientData
  }, [challenge])

  React.useEffect(() => {
    if (!challenge || challenge.method !== 'mfa' || !selectedMethod) return
    if (preparedMethods[selectedMethod]) return

    let active = true
    setLoading(true)
    setError(null)

    prepare(selectedMethod)
      .then((clientData) => {
        if (!active) return
        setPreparedClientData((current) => ({ ...current, [selectedMethod]: clientData }))
        setPreparedMethods((current) => ({ ...current, [selectedMethod]: true }))
      })
      .catch((err) => {
        if (!active) return
        setError(
          readErrorMessage(
            err,
            t('security.admin.sudo.challenge.errors.prepare', 'Failed to prepare sudo challenge.'),
          ),
        )
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [challenge, prepare, preparedMethods, selectedMethod, t])

  const verify = React.useCallback(async (methodType: string, payload: Record<string, unknown>) => {
    if (!challenge) return
    const result = await readApiResultOrThrow<VerifyResponse>('/api/security/sudo/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: challenge.sessionId,
        targetIdentifier: challenge.targetIdentifier,
        methodType,
        payload,
      }),
    })
    onResolve(result)
  }, [challenge, onResolve])

  const handlePasswordVerify = React.useCallback(async () => {
    if (!challenge) return
    setLoading(true)
    setError(null)
    try {
      await verify('password', { password })
    } catch (err) {
      setError(
        readErrorMessage(
          err,
          t('security.admin.sudo.challenge.errors.verify', 'Failed to verify sudo challenge.'),
        ),
      )
    } finally {
      setLoading(false)
    }
  }, [challenge, password, t, verify])

  const handleMfaVerify = React.useCallback(async (payload: Record<string, unknown>) => {
    if (!selectedMethod) return
    setLoading(true)
    setError(null)
    try {
      await verify(selectedMethod, payload)
    } catch (err) {
      setError(
        readErrorMessage(
          err,
          t('security.admin.sudo.challenge.errors.verify', 'Failed to verify sudo challenge.'),
        ),
      )
    } finally {
      setLoading(false)
    }
  }, [selectedMethod, t, verify])

  const handlePrepare = React.useCallback(async () => {
    if (!selectedMethod) return
    const cached = preparedClientData[selectedMethod]
    if (preparedMethods[selectedMethod]) {
      return cached
    }

    setLoading(true)
    setError(null)
    try {
      const clientData = await prepare(selectedMethod)
      setPreparedClientData((current) => ({ ...current, [selectedMethod]: clientData }))
      setPreparedMethods((current) => ({ ...current, [selectedMethod]: true }))
      return clientData
    } catch (err) {
      setError(
        readErrorMessage(
          err,
          t('security.admin.sudo.challenge.errors.prepare', 'Failed to prepare sudo challenge.'),
        ),
      )
    } finally {
      setLoading(false)
    }
    return undefined
  }, [prepare, preparedClientData, preparedMethods, selectedMethod, t])

  const handleClose = React.useCallback(() => {
    onResolve(null)
  }, [onResolve])

  const selected = challenge?.availableMfaMethods.find((method) => method.type === selectedMethod) ?? null
  const alternativeMethods = React.useMemo(
    () => challenge?.availableMfaMethods.filter((method) => method.type !== selectedMethod) ?? [],
    [challenge, selectedMethod],
  )
  const ChallengeComponent = useProviderChallengeComponent(selected ?? { type: 'unknown' })

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleClose() }}>
      <DialogContent
        className="sm:max-w-lg [&_[data-dialog-close]]:rounded-full [&_[data-dialog-close]]:border [&_[data-dialog-close]]:border-white/20 [&_[data-dialog-close]]:bg-white/5 [&_[data-dialog-close]]:opacity-100 [&_[data-dialog-close]]:transition-none [&_[data-dialog-close]]:hover:bg-white/10 [&_[data-dialog-close]]:hover:opacity-100 [&_[data-dialog-close]]:focus:ring-0 [&_[data-dialog-close]]:focus:ring-offset-0"
        onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && challenge?.method === 'password') {
          event.preventDefault()
          void handlePasswordVerify()
        }
      }}
      >
        <DialogHeader>
          <DialogTitle>{t('security.admin.sudo.challenge.title', 'Confirm sensitive action')}</DialogTitle>
          <DialogDescription>
            {t(
              'security.admin.sudo.challenge.description',
              'Re-authenticate to continue with this protected action.',
            )}
          </DialogDescription>
        </DialogHeader>

        {challenge?.method === 'password' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="sudo-password">
                {t('security.admin.sudo.challenge.password.label', 'Password')}
              </label>
              <Input
                id="sudo-password"
                type="password"
                value={password}
                autoFocus
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('security.admin.sudo.challenge.password.placeholder', 'Enter your password')}
              />
            </div>

            {error ? <p className="text-sm text-red-500" role="alert">{error}</p> : null}

            <div className="space-y-3">
              <Button
                type="button"
                className="w-full"
                onClick={() => void handlePasswordVerify()}
                disabled={loading || password.trim().length === 0}
              >
                {t('security.admin.sudo.challenge.actions.verify', 'Verify')}
              </Button>
              <div className="flex justify-center">
                <Button type="button" variant="outline" className="min-w-28" onClick={handleClose} disabled={loading}>
                  {t('ui.actions.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          </div>
        ) : challenge?.method === 'mfa' && selected ? (
          <div className="space-y-4">
            <ChallengeComponent
              method={selected}
              loading={loading}
              onVerify={handleMfaVerify}
              onPrepare={handlePrepare}
              onResend={handlePrepare}
              submitLabel={t('security.admin.sudo.challenge.actions.verify', 'Verify')}
            />

            {alternativeMethods.length > 0 ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center"
                  onClick={() => setShowMoreOptions((current) => !current)}
                >
                  {t('security.admin.sudo.challenge.actions.moreOptions', 'Use another method')}
                  {showMoreOptions ? <ChevronUp className="ml-2 size-4" /> : <ChevronDown className="ml-2 size-4" />}
                </Button>
                {showMoreOptions ? (
                  <div className="space-y-2">
                    {alternativeMethods.map((method) => (
                      <Button
                        key={`${challenge.sessionId}:${method.type}`}
                        type="button"
                        variant="outline"
                        className="w-full justify-center"
                        onClick={() => {
                          setSelectedMethod(method.type)
                          setError(null)
                          setShowMoreOptions(false)
                        }}
                      >
                        {method.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? <p className="text-sm text-red-500" role="alert">{error}</p> : null}

          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="size-4" />
            <span>{t('security.admin.sudo.challenge.noMethods', 'No sudo authentication methods are available.')}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
