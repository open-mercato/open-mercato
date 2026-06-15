"use client"
import { useCallback, useMemo, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SearchX } from 'lucide-react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { PortalInjectionSpots } from '@open-mercato/ui/backend/injection/spotIds'

type Props = { params: { orgSlug: string } }

export default function PortalInvitePage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const orgSlug = params.orgSlug
  const { tenant } = usePortalContext()
  const searchParams = useSearchParams()

  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const tokenParam = searchParams.get('token')
    if (!tokenParam) {
      setError(t('portal.invite.error.noToken', 'Invalid or missing invitation token.'))
    } else {
      setToken(tokenParam)
    }
  }, [searchParams, t])

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setError(null)

      if (!token) {
        setError(t('portal.invite.error.noToken', 'Invalid or missing invitation token.'))
        return
      }

      if (!displayName.trim()) {
        setError(t('portal.invite.error.displayNameRequired', 'Display name is required.'))
        return
      }

      if (password !== confirmPassword) {
        setError(t('portal.invite.error.passwordMismatch', 'Passwords do not match.'))
        return
      }

      if (password.length < 8) {
        setError(t('portal.invite.error.passwordTooShort', 'Password must be at least 8 characters long.'))
        return
      }

      setSubmitting(true)
      try {
        const result = await apiCall<{ ok: boolean; error?: string }>('/api/customer_accounts/invitations/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password, displayName: displayName.trim() }),
        })

        if (result.ok && result.result?.ok) {
          router.replace(`/${orgSlug}/portal/dashboard`)
          return
        }

        if (result.status === 400) {
          setError(t('portal.invite.error.invalidToken', 'Invalid or expired invitation.'))
        } else {
          setError(result.result?.error || t('portal.invite.error.generic', 'Invitation acceptance failed. Please try again.'))
        }
      } catch {
        setError(t('portal.invite.error.generic', 'Invitation acceptance failed. Please try again.'))
      } finally {
        setSubmitting(false)
      }
    },
    [token, password, confirmPassword, displayName, orgSlug, router, t],
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
        <EmptyState
          variant="subtle"
          size="lg"
          icon={<SearchX className="h-6 w-6" aria-hidden />}
          title={t('portal.org.invalid', 'Organization not found.')}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t('portal.invite.title', 'Accept Invitation')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('portal.invite.description', 'Create your portal account to accept this invitation.')}</p>
      </div>

      <InjectionSpot spotId={PortalInjectionSpots.pageBefore('invite')} context={injectionContext} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-display-name" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.invite.displayName', 'Display Name')}</Label>
          <Input id="invite-display-name" autoComplete="name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={submitting || !token} className="rounded-lg" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-password" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.invite.password', 'Password')}</Label>
          <PasswordInput id="invite-password" autoComplete="new-password" required placeholder={t('portal.invite.password.placeholder', '••••••••')} value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting || !token} className="rounded-lg" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-confirm-password" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.invite.confirmPassword', 'Confirm Password')}</Label>
          <PasswordInput id="invite-confirm-password" autoComplete="new-password" required placeholder={t('portal.invite.confirmPassword.placeholder', '••••••••')} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={submitting || !token} className="rounded-lg" />
        </div>

        <Button type="submit" disabled={submitting || !token} className="mt-1 w-full rounded-lg">
          {submitting ? t('portal.invite.submitting', 'Accepting invitation...') : t('portal.invite.submit', 'Accept Invitation')}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          {t('portal.invite.backToLogin', 'Already have an account?')}{' '}
          <Link href={`/${orgSlug}/portal/login`} className="font-medium text-foreground underline underline-offset-4 hover:opacity-80">
            {t('portal.invite.loginLink', 'Sign in')}
          </Link>
        </p>
      </form>

      <InjectionSpot spotId={PortalInjectionSpots.pageAfter('invite')} context={injectionContext} />
    </div>
  )
}
