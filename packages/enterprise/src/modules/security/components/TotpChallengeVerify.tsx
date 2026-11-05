'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'

type TotpChallengeVerifyProps = {
  onVerify: (payload: { code: string }) => Promise<void>
  submitLabel: string
}

export default function TotpChallengeVerify({
  onVerify,
  submitLabel,
}: TotpChallengeVerifyProps) {
  const t = useT()
  const [code, setCode] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

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

  return (
    <form className="grid gap-3" onSubmit={handleSubmit}>
      <h2 className="text-center text-2xl font-semibold text-slate-100">
        {t('security.login.mfaChallenge.totp.title', 'Two-factor authentication')}
      </h2>
      <p className="text-center text-sm text-slate-300">
        {t(
          'security.login.mfaChallenge.totp.description',
          'Enter the code from your two-factor authentication app or browser extension below.',
        )}
      </p>
      <div className="grid gap-1">
        <Label htmlFor="totp-code" className="text-slate-200">
          {t('security.login.mfaChallenge.totp.codeLabel', 'Verification code')}
        </Label>
        <Input
          id="totp-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t('security.login.mfaChallenge.totp.placeholder', 'XXXXXX')}
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          className="h-10 border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
        />
      </div>
      <div>
        <Button type="submit" disabled={!canSubmit} className="mt-2 h-10 w-full">
          {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
