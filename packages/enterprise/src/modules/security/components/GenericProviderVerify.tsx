'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'

type GenericProviderVerifyProps = {
  onVerify: (payload: { code: string }) => Promise<void>
  onCancel?: () => void
  onResend?: () => Promise<unknown>
  submitLabel?: string
}

export default function GenericProviderVerify({
  onVerify,
  onCancel,
  onResend,
  submitLabel,
}: GenericProviderVerifyProps) {
  const t = useT()
  const [code, setCode] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [resending, setResending] = React.useState(false)

  const canSubmit = code.trim().length > 0 && !submitting

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
    <form className="space-y-3" onSubmit={handleSubmit}>
      <Input
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder={t('security.profile.mfa.verify.codePlaceholder', 'Enter verification code')}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {submitLabel ?? t('security.profile.mfa.verify.submit', 'Verify')}
        </Button>
        {onResend ? (
          <Button type="button" variant="outline" disabled={resending} onClick={handleResend}>
            {resending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {t('security.profile.mfa.verify.resend', 'Resend code')}
          </Button>
        ) : null}
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('ui.actions.cancel', 'Cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
