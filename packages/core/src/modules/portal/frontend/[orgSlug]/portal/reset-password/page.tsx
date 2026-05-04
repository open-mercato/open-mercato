"use client"
import { useCallback, useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { PortalInjectionSpots } from '@open-mercato/ui/backend/injection/spotIds'

type Props = { params: { orgSlug: string } }

export default function PortalResetPasswordPage({ params }: Props) {
  const t = useT()
  const orgSlug = params.orgSlug
  const { tenant } = usePortalContext()
  const searchParams = useSearchParams()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const tokenParam = searchParams.get('token')
    if (!tokenParam) {
      setError(t('portal.resetPassword.error.noToken', 'Invalid or missing reset token.'))
    } else {
      setToken(tokenParam)
    }
  }, [searchParams, t])

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setError(null)

      if (!token) {
        setError(t('portal.resetPassword.error.noToken', 'Invalid or missing reset token.'))
        return
      }

      if (password !== confirmPassword) {
        setError(t('portal.resetPassword.error.passwordMismatch', 'Passwords do not match.'))
        return
      }

      if (password.length < 8) {
        setError(t('portal.resetPassword.error.passwordTooShort', 'Password must be at least 8 characters long.'))
        return
      }

      setSubmitting(true)
      try {
        const result = await apiCall<{ ok: boolean; error?: string }>('/api/customer_accounts/password/reset-confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        })

        if (result.ok && result.result?.ok) {
          setSuccess(true)
          return
        }

        if (result.status === 400) {
          setError(t('portal.resetPassword.error.invalidToken', 'Invalid or expired reset token.'))
        } else {
          setError(result.result?.error || t('portal.resetPassword.error.generic', 'Password reset failed. Please try again.'))
        }
      } catch {
        setError(t('portal.resetPassword.error.generic', 'Password reset failed. Please try again.'))
      } finally {
        setSubmitting(false)
      }
    },
    [token, password, confirmPassword, t],
  )

  const injectionContext = useMemo(
    () => ({ orgSlug }),
    [orgSlug],
  )

  if (tenant.loading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>
  }

  if (tenant.error) {
    return (
      <div className="mx-auto w-full max-w-md py-12">
        <Alert variant="destructive">
          <AlertDescription>{t('portal.org.invalid', 'Organization not found.')}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (success) {
    return (
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t('portal.resetPassword.success.title', 'Password Reset Complete')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('portal.resetPassword.success.description', 'Your password has been successfully reset.')}</p>
        </div>

        <Alert>
          <AlertDescription>{t('portal.resetPassword.success.message', 'You can now sign in with your new password.')}</AlertDescription>
        </Alert>

        <div className="mt-6 text-center">
          <Link href={`/${orgSlug}/portal/login`} className="font-medium text-foreground underline underline-offset-4 hover:opacity-80">
            {t('portal.resetPassword.success.loginLink', 'Go to Sign In')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t('portal.resetPassword.title', 'Reset Password')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('portal.resetPassword.description', 'Enter your new password below.')}</p>
      </div>

      <InjectionSpot spotId={PortalInjectionSpots.pageBefore('reset-password')} context={injectionContext} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-password" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.resetPassword.password', 'New Password')}</Label>
          <Input id="reset-password" type="password" autoComplete="new-password" required placeholder={t('portal.resetPassword.password.placeholder', '••••••••')} value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting || !token} className="rounded-lg" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-password" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.resetPassword.confirmPassword', 'Confirm New Password')}</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" required placeholder={t('portal.resetPassword.confirmPassword.placeholder', '••••••••')} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={submitting || !token} className="rounded-lg" />
        </div>

        <Button type="submit" disabled={submitting || !token} className="mt-1 w-full rounded-lg">
          {submitting ? t('portal.resetPassword.submitting', 'Resetting password...') : t('portal.resetPassword.submit', 'Reset Password')}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          {t('portal.resetPassword.backToLogin', 'Remember your password?')}{' '}
          <Link href={`/${orgSlug}/portal/login`} className="font-medium text-foreground underline underline-offset-4 hover:opacity-80">
            {t('portal.resetPassword.loginLink', 'Sign in')}
          </Link>
        </p>
      </form>

      <InjectionSpot spotId={PortalInjectionSpots.pageAfter('reset-password')} context={injectionContext} />
    </div>
  )
}