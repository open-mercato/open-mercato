'use client'

import * as React from 'react'
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'
import { Loader2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

type PasskeyChallengeVerifyProps = {
  loading: boolean
  onPrepare: () => Promise<Record<string, unknown> | undefined>
  onVerify: (payload: { response: unknown }) => Promise<void>
}

function readErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Passkey verification failed.'
}

function isAbortError(error: unknown): boolean {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
  if (name === 'AbortError' || name === 'NotAllowedError') {
    return true
  }

  const message = readErrorMessage(error).toLowerCase()
  return message.includes('cancel') || message.includes('aborted') || message.includes('not allowed')
}

export default function PasskeyChallengeVerify({
  loading,
  onPrepare,
  onVerify,
}: PasskeyChallengeVerifyProps) {
  const t = useT()

  const handleVerify = React.useCallback(async () => {
    if (!browserSupportsWebAuthn()) {
      throw new Error(
        t('security.login.mfaChallenge.passkey.unsupported', 'Passkeys are not supported by this browser.'),
      )
    }

    try {
      const optionsJSON = await onPrepare()
      if (!optionsJSON || typeof optionsJSON !== 'object') {
        throw new Error('Passkey options are missing from challenge response.')
      }
      const response = await startAuthentication({ optionsJSON: optionsJSON as never })
      await onVerify({ response })
    } catch (error) {
      if (isAbortError(error)) {
        return
      }
      throw error
    }
  }, [onPrepare, onVerify, t])

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (loading) return
        void handleVerify()
      }}
    >
      <h2 className="text-center text-2xl font-semibold text-slate-100">
        {t('security.login.mfaChallenge.passkey.title', 'Two-factor authentication')}
      </h2>
      <p className="text-center text-sm text-slate-300">
        {t('security.login.mfaChallenge.passkey.description', 'Authenticate using your security key.')}
      </p>
      <div>
        <Button type="submit" disabled={loading} className="mt-2 h-10 w-full">
          {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t('security.login.mfaChallenge.passkey.action', 'Use passkey')}
        </Button>
      </div>
    </form>
  )
}
