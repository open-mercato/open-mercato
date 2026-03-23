'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'

type OtpEmailChallengeVerifyProps = {
  onVerify: (payload: { code: string }) => Promise<void>
  onResend?: () => Promise<unknown>
  submitLabel: string
}

export default function OtpEmailChallengeVerify({
  onVerify,
  onResend,
  submitLabel,
}: OtpEmailChallengeVerifyProps) {
  const t = useT()
  const [code, setCode] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [resending, setResending] = React.useState(false)

  const canSubmit = code.trim().length >= 6 && !submitting

  const handleSubmit = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onVerify({ code: code.trim() })
      setCode('')
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, code, onVerify])

  const handleResend = React.useCallback(async () => {
    if (!onResend || resending) return
    setResending(true)
    try {
      await onResend()
    } finally {
      setResending(false)
    }
  }, [onResend, resending])

  return (
    <form className="grid gap-3" onSubmit={handleSubmit}>
      <h2 className="text-center text-2xl font-semibold text-slate-100">
        {t('security.login.mfaChallenge.otpEmail.title', 'Two-factor authentication')}
      </h2>
      <p className="text-center text-sm text-slate-300">
        {t(
          'security.login.mfaChallenge.otpEmail.description',
          'Enter the 6-digit code sent to your email address.',
        )}
      </p>
      <div className="grid gap-1">
        <Label htmlFor="otp-email-code" className="text-slate-200">
          {t('security.login.mfaChallenge.otpEmail.codeLabel', 'Verification code')}
        </Label>
        <Input
          id="otp-email-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t('security.login.mfaChallenge.otpEmail.placeholder', 'XXXXXX')}
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          className="h-10 border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
        />
      </div>
      <div className="grid gap-2">
        <Button type="submit" disabled={!canSubmit} className="h-10 w-full">
          {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
        {onResend ? (
          <Button type="button" variant="outline" disabled={resending} className="h-10 w-full" onClick={handleResend}>
            {resending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {t('security.login.mfaChallenge.otpEmail.resend', 'Resend code')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
