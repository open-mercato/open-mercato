'use client'

import * as React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { useProviderChallengeComponent } from './mfa-ui-registry'

export type MfaChallengeMethod = {
  type: string
  label: string
  icon: string
  components?: {
    list?: string
    details?: string
    challenge?: string
  }
}

const RECOVERY_CODE_METHOD_TYPE = 'recovery_code'

type MfaChallengePanelProps = {
  challengeId: string
  availableMethods: MfaChallengeMethod[]
  onBack: () => void
}

type PrepareResponse = {
  ok: boolean
  clientData?: Record<string, unknown>
}

type VerifyResponse = {
  ok: boolean
  redirect?: string
}

function readErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Failed to verify MFA challenge.'
}

export default function MfaChallengePanel({
  challengeId,
  availableMethods,
  onBack,
}: MfaChallengePanelProps) {
  const t = useT()
  const methods = React.useMemo<MfaChallengeMethod[]>(() => {
    const includesRecovery = availableMethods.some((method) => method.type === RECOVERY_CODE_METHOD_TYPE)
    if (includesRecovery) return availableMethods
    return [
      ...availableMethods,
      {
        type: RECOVERY_CODE_METHOD_TYPE,
        label: t('security.login.mfaChallenge.recovery.option', '2FA recovery code'),
        icon: 'KeyRound',
      },
    ]
  }, [availableMethods, t])

  const [selectedMethod, setSelectedMethod] = React.useState<string>(methods[0]?.type ?? '')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [preparedMethods, setPreparedMethods] = React.useState<Record<string, true>>({})
  const [showMoreOptions, setShowMoreOptions] = React.useState(false)

  React.useEffect(() => {
    if (methods.some((method) => method.type === selectedMethod)) return
    setSelectedMethod(methods[0]?.type ?? '')
  }, [methods, selectedMethod])

  const verify = React.useCallback(async (methodType: string, payload: Record<string, unknown>) => {
    const result = await readApiResultOrThrow<VerifyResponse>('/api/security/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        methodType,
        payload,
      }),
    })

    const redirect = typeof result.redirect === 'string' && result.redirect.length > 0
      ? result.redirect
      : '/backend'

    window.location.href = redirect
  }, [challengeId])

  const prepare = React.useCallback(async (methodType: string) => {
    return readApiResultOrThrow<PrepareResponse>('/api/security/mfa/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        methodType,
      }),
    })
  }, [challengeId])

  const verifyRecoveryCode = React.useCallback(async (payload: Record<string, unknown>) => {
    const code = typeof payload.code === 'string' ? payload.code.trim() : ''
    const result = await readApiResultOrThrow<VerifyResponse>('/api/security/mfa/recovery', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    const redirect = typeof result.redirect === 'string' && result.redirect.length > 0
      ? result.redirect
      : '/backend'
    window.location.href = redirect
  }, [])

  const handleVerify = React.useCallback(async (payload: Record<string, unknown>) => {
    if (!selectedMethod) return

    setLoading(true)
    setError(null)
    try {
      if (selectedMethod === RECOVERY_CODE_METHOD_TYPE) {
        await verifyRecoveryCode(payload)
      } else {
        await verify(selectedMethod, payload)
      }
    } catch (err) {
      setError(readErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [selectedMethod, verify, verifyRecoveryCode])

  const handlePrepare = React.useCallback(async () => {
    if (!selectedMethod) return

    setLoading(true)
    setError(null)
    try {
      const prepared = await prepare(selectedMethod)
      return prepared.clientData
    } catch (err) {
      setError(readErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [prepare, selectedMethod])

  const handleResend = handlePrepare

  React.useEffect(() => {
    if (!selectedMethod || selectedMethod !== 'otp_email' || preparedMethods[selectedMethod]) {
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    prepare(selectedMethod)
      .then(() => {
        if (!active) return
        setPreparedMethods((current) => ({ ...current, [selectedMethod]: true }))
      })
      .catch((err) => {
        if (!active) return
        setError(readErrorMessage(err))
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [prepare, preparedMethods, selectedMethod])

  const selected = methods.find((method) => method.type === selectedMethod) ?? null
  const alternativeMethods = methods.filter((method) => method.type !== selectedMethod)
  const ChallengeComponent = useProviderChallengeComponent(selected ?? { type: 'unknown' })

  return (
    <section
      className="rounded-lg border border-border bg-card p-6 text-card-foreground"
      data-testid="security-mfa-challenge-panel"
    >
      <div className="space-y-5">

        {methods.length > 0 ? (
          <div className="space-y-3">
            {selected ? (
              <ChallengeComponent
                method={selected}
                loading={loading}
                onVerify={handleVerify}
                onPrepare={handlePrepare}
                onResend={selected.type === 'otp_email' ? handleResend : undefined}
                submitLabel={t('security.login.mfaChallenge.actions.verify', 'Verify')}
              />
            ) : null}

            {alternativeMethods.length > 0 ? (
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full justify-center text-sm"
                  onClick={() => setShowMoreOptions((current) => !current)}
                >
                  {t('security.login.mfaChallenge.actions.moreOptions', 'More options')}
                  {showMoreOptions ? <ChevronUp className="ml-2 size-4" aria-hidden="true" /> : <ChevronDown className="ml-2 size-4" aria-hidden="true" />}
                </Button>

                {showMoreOptions ? (
                  <div className="space-y-2">
                    {alternativeMethods.map((method) => (
                      <Button
                        key={`${challengeId}:${method.type}`}
                        type="button"
                        variant={method.type === RECOVERY_CODE_METHOD_TYPE ? 'destructive-ghost' : 'outline'}
                        className="h-10 w-full justify-center text-sm"
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

            {error ? (
              <p className="text-sm text-status-error-text" role="alert">{error}</p>
            ) : null}

            <div className="pt-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={onBack}
              >
                {t('security.login.mfaChallenge.actions.back', 'Back to sign in')}
              </Button>
            </div>
          </div>
        ) : (
          <Alert status="warning" style="lighter">
            <AlertDescription>
              {t('security.login.mfaChallenge.noMethods', 'No MFA methods are currently available for this account.')}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </section>
  )
}
