"use client"
import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { PortalInjectionSpots } from '@open-mercato/ui/backend/injection/spotIds'

type Props = { params: { orgSlug: string } }

export default function PortalSignupPage({ params }: Props) {
  const t = useT()
  const orgSlug = params.orgSlug
  const { tenant } = usePortalContext()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setError(null)

      if (!tenant.tenantId || !tenant.organizationId) {
        setError(t('portal.org.invalid', 'Organization not found.'))
        return
      }

      setSubmitting(true)
      try {
        const result = await apiCall<{ ok: boolean; error?: string }>('/api/customer_accounts/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, displayName, tenantId: tenant.tenantId, organizationId: tenant.organizationId }),
        })

        if (result.status === 201 && result.result?.ok) {
          setSuccess(true)
          return
        }

        setError(result.result?.error || t('portal.signup.error.generic', 'Signup failed. Please try again.'))
      } catch {
        setError(t('portal.signup.error.generic', 'Signup failed. Please try again.'))
      } finally {
        setSubmitting(false)
      }
    },
    [displayName, email, password, tenant.tenantId, tenant.organizationId, t],
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
        <Notice variant="error">{t('portal.org.invalid', 'Organization not found.')}</Notice>
      </div>
    )
  }

  if (success) {
    return (
      <div className="mx-auto w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-foreground text-background">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{t('portal.signup.success.title', 'Account Created')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('portal.signup.success.description', 'Your account has been created. You can now sign in.')}</p>
        <Button asChild className="mt-6 w-full rounded-lg">
          <Link href={`/${orgSlug}/portal/login`}>{t('portal.signup.success.loginLink', 'Sign In')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t('portal.signup.title', 'Create Account')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('portal.signup.description', 'Sign up for a portal account.')}</p>
      </div>

      <InjectionSpot spotId={PortalInjectionSpots.pageBefore('signup')} context={injectionContext} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error ? <Notice variant="error">{error}</Notice> : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.signup.displayName', 'Full Name')}</Label>
          <Input id="signup-name" type="text" autoComplete="name" required placeholder={t('portal.signup.displayName.placeholder', 'Jane Smith')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={submitting} className="rounded-lg" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-email" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.signup.email', 'Email')}</Label>
          <Input id="signup-email" type="email" autoComplete="email" required placeholder={t('portal.signup.email.placeholder', 'you@example.com')} value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} className="rounded-lg" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-password" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.signup.password', 'Password')}</Label>
          <Input id="signup-password" type="password" autoComplete="new-password" required placeholder={t('portal.signup.password.placeholder', '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022')} value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} className="rounded-lg" />
        </div>

        <Button type="submit" disabled={submitting} className="mt-1 w-full rounded-lg">
          {submitting ? t('portal.signup.submitting', 'Creating account...') : t('portal.signup.submit', 'Create Account')}
        </Button>

        <p className="text-center text-[13px] text-muted-foreground">
          {t('portal.signup.hasAccount', 'Already have an account?')}{' '}
          <Link href={`/${orgSlug}/portal/login`} className="font-medium text-foreground underline underline-offset-4 hover:opacity-80">
            {t('portal.signup.loginLink', 'Sign in')}
          </Link>
        </p>
      </form>

      <InjectionSpot spotId={PortalInjectionSpots.pageAfter('signup')} context={injectionContext} />
    </div>
  )
}
