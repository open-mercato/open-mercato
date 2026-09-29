"use client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatPasswordRequirements, getPasswordPolicy, validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'

type TokenState = 'checking' | 'usable' | 'expired'

export default function ResetWithTokenPage({ params }: { params: { token: string } }) {
  const router = useRouter()
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [clientReady, setClientReady] = useState(false)
  const [tokenState, setTokenState] = useState<TokenState>('checking')
  const passwordPolicy = getPasswordPolicy()
  const passwordRequirements = formatPasswordRequirements(passwordPolicy, t)
  const passwordDescription = passwordRequirements
    ? t('auth.password.requirements.help', 'Password requirements: {requirements}', { requirements: passwordRequirements })
    : ''

  useEffect(() => {
    setClientReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function checkToken() {
      const body = new FormData()
      body.set('token', params.token)
      // Fail open whenever the check cannot answer — an unreachable or failing
      // endpoint must not strand a user holding a perfectly good link, and the
      // confirm endpoint still rejects a dead token on submit.
      try {
        const { ok, result } = await apiCall<{ ok?: boolean; valid?: boolean }>(
          '/api/auth/reset/validate',
          { method: 'POST', body },
        )
        if (cancelled) return
        setTokenState(ok && result?.valid === false ? 'expired' : 'usable')
      } catch {
        if (cancelled) return
        setTokenState('usable')
      }
    }
    void checkToken()
    return () => { cancelled = true }
  }, [params.token])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password') ?? '')
    const confirmPassword = String(form.get('confirmPassword') ?? '')

    if (!password) {
      setError(t('auth.profile.form.errors.newPasswordRequired', 'New password is required.'))
      return
    }
    if (!confirmPassword) {
      setError(t('auth.profile.form.errors.confirmPasswordRequired', 'Please confirm the new password.'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('auth.profile.form.errors.passwordMismatch', 'Passwords do not match.'))
      return
    }
    if (!validatePassword(password, passwordPolicy).ok) {
      setError(t('auth.profile.form.errors.passwordRequirements', 'Password must meet the requirements.'))
      return
    }

    setSubmitting(true)
    try {
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

  if (tokenState === 'checking') {
    return (
      <div className="min-h-svh flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t('auth.reset.title', 'Set a new password')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-auth-token-state="checking">
              <Spinner size="sm" />
              <span>{t('auth.reset.token.checking', 'Checking your reset link...')}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (tokenState === 'expired') {
    return (
      <div className="min-h-svh flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t('auth.reset.token.expiredTitle', 'This reset link is no longer valid')}</CardTitle>
            <CardDescription>
              {t('auth.reset.token.expiredSubtitle', 'It has already been used or has expired. Request a new link to set your password.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3" data-auth-token-state="expired">
              <Button asChild className="w-full">
                <Link href="/reset">{t('auth.reset.token.requestNew', 'Request a new link')}</Link>
              </Button>
              <div className="text-center">
                <Link href="/login" className="text-xs text-muted-foreground underline">
                  {t('auth.reset.backToLogin', 'Back to login')}
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-svh flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('auth.reset.title', 'Set a new password')}</CardTitle>
          <CardDescription>{t('auth.reset.subtitle', 'Choose a strong password for your account.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={onSubmit} data-auth-ready={clientReady ? '1' : '0'}>
            {error && <div className="text-sm text-status-error-text">{error}</div>}
            <div className="grid gap-1">
              <Label htmlFor="password">{t('auth.reset.form.password', 'New password')}</Label>
              <PasswordInput id="password" name="password" required minLength={passwordPolicy.minLength} autoComplete="new-password" />
              {passwordDescription ? (
                <p className="text-xs text-muted-foreground">{passwordDescription}</p>
              ) : null}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="confirmPassword">{t('auth.profile.form.confirmPassword', 'Confirm new password')}</Label>
              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                required
                minLength={passwordPolicy.minLength}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="mt-2 w-full" disabled={submitting}>
              {submitting ? t('auth.reset.form.loading', '...') : t('auth.reset.form.submit', 'Update password')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
