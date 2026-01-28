"use client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatPasswordRequirements, getPasswordPolicy } from '@open-mercato/shared/lib/auth/passwordPolicy'

export default function ResetWithTokenPage({ params }: { params: { token: string } }) {
  const router = useRouter()
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const passwordPolicy = getPasswordPolicy()
  const passwordRequirements = formatPasswordRequirements(passwordPolicy, t)
  const passwordDescription = passwordRequirements
    ? t('auth.password.requirements.help', 'Password requirements: {requirements}', { requirements: passwordRequirements })
    : ''

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const form = new FormData(e.currentTarget)
      form.set('token', params.token)
      const { ok, result } = await apiCall<{ ok?: boolean; error?: string; redirect?: string }>(
        '/api/auth/reset/confirm',
        { method: 'POST', body: form },
      )
      if (!ok || result?.ok === false) {
        setError(result?.error || t('auth.reset.errors.failed', 'Unable to reset password'))
        return
      }
      router.replace(result?.redirect || '/login')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('auth.reset.title', 'Set a new password')}</CardTitle>
          <CardDescription>{t('auth.reset.subtitle', 'Choose a strong password for your account.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={onSubmit}>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="grid gap-1">
              <Label htmlFor="password">{t('auth.reset.form.password', 'New password')}</Label>
              <Input id="password" name="password" type="password" required minLength={passwordPolicy.minLength} />
              {passwordDescription ? (
                <p className="text-xs text-muted-foreground">{passwordDescription}</p>
              ) : null}
            </div>
            <button disabled={submitting} className="h-10 rounded-md bg-foreground text-background mt-2 hover:opacity-90 transition disabled:opacity-60">
              {submitting ? t('auth.reset.form.loading', '...') : t('auth.reset.form.submit', 'Update password')}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
