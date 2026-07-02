"use client"
import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { EmailInput } from '@open-mercato/ui/primitives/email-input'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SearchX, Check } from 'lucide-react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { PortalInjectionSpots } from '@open-mercato/ui/backend/injection/spotIds'

type Props = { params: { orgSlug: string } }
type SignupResponse = { ok: boolean; error?: string; details?: Record<string, string[]> }

export default function PortalSignupPage({ params }: Props) {
  const t = useT()
  const orgSlug = params.orgSlug
  const { tenant } = usePortalContext()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setError(null)
      setFieldErrors({})

      if (!tenant.organizationId) {
        setError(t('portal.org.invalid', 'Organization not found.'))
        return
      }

      setSubmitting(true)
      try {
        const result = await apiCall<SignupResponse>('/api/customer_accounts/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, displayName, organizationId: tenant.organizationId }),
        })

        if (result.status === 202 && result.result?.ok) {
          setSuccess(true)
          return
        }

        const details = result.result?.details
        if (details && Object.keys(details).length > 0) {
          const mapped: Record<string, string> = {}
          if (details.displayName?.length) {
            mapped.displayName = t('portal.signup.error.displayName.required', 'Full name is required.')
          }
          if (details.email?.length) {
            mapped.email = t('portal.signup.error.email.invalid', 'Please enter a valid email address.')
          }
          if (details.password?.length) {
            mapped.password = t('portal.signup.error.password.minLength', 'Password must be at least 8 characters.')
          }
          setFieldErrors(mapped)
        } else {
          setError(result.result?.error || t('portal.signup.error.generic', 'Signup failed. Please try again.'))
        }
      } catch {
        setError(t('portal.signup.error.generic', 'Signup failed. Please try again.'))
      } finally {
        setSubmitting(false)
      }
    },
    [displayName, email, password, tenant.organizationId, t],
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

  if (success) {
    return (
      <div className="mx-auto w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-foreground text-background">
          <Check className="size-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{t('portal.signup.success.title', 'Check your email')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t(
          'portal.signup.success.description',
          'If your registration was accepted, check your email for next steps before signing in. Some organizations require an administrator to activate new accounts.',
        )}</p>
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
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-name" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.signup.displayName', 'Full Name')}</Label>
          <Input id="signup-name" type="text" autoComplete="name" required placeholder={t('portal.signup.displayName.placeholder', 'Jane Smith')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={submitting} className="rounded-lg" />
          {fieldErrors.displayName && <p className="text-sm text-destructive">{fieldErrors.displayName}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-email" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.signup.email', 'Email')}</Label>
          <EmailInput id="signup-email" required placeholder={t('portal.signup.email.placeholder', 'you@example.com')} value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} className="rounded-lg" />
          {fieldErrors.email && <p className="text-sm text-destructive">{fieldErrors.email}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-password" className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.signup.password', 'Password')}</Label>
          <PasswordInput id="signup-password" autoComplete="new-password" required placeholder={t('portal.signup.password.placeholder', '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022')} value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} className="rounded-lg" />
          {fieldErrors.password && <p className="text-sm text-destructive">{fieldErrors.password}</p>}
        </div>

        <Button type="submit" disabled={submitting} className="mt-1 w-full rounded-lg">
          {submitting ? t('portal.signup.submitting', 'Creating account...') : t('portal.signup.submit', 'Create Account')}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
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
