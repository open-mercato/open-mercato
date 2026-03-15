"use client"
import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { PortalShell } from '@open-mercato/ui/portal/PortalShell'
import { useTenantContext } from '@open-mercato/ui/portal/hooks/useTenantContext'

type Props = { params: { orgSlug: string } }

export default function PortalLoginPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const orgSlug = params.orgSlug
  const { tenantId, organizationName, loading: ctxLoading, error: ctxError } = useTenantContext(orgSlug)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setError(null)

      if (!tenantId) {
        setError(t('portal.org.invalid', 'Organization not found.'))
        return
      }

      setSubmitting(true)
      try {
        const res = await fetch('/api/customer_accounts/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, password, tenantId }),
        })

        const data = await res.json().catch(() => null)

        if (res.ok && data?.ok) {
          router.push(`/${orgSlug}/portal/dashboard`)
          return
        }

        if (res.status === 423) {
          setError(t('portal.login.error.locked', 'Account locked. Try again later.'))
        } else if (res.status === 401) {
          setError(t('portal.login.error.invalidCredentials', 'Invalid email or password.'))
        } else {
          setError(data?.error || t('portal.login.error.generic', 'Login failed. Please try again.'))
        }
      } catch {
        setError(t('portal.login.error.generic', 'Login failed. Please try again.'))
      } finally {
        setSubmitting(false)
      }
    },
    [email, password, tenantId, orgSlug, router, t],
  )

  if (ctxLoading) {
    return (
      <PortalShell orgSlug={orgSlug}>
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      </PortalShell>
    )
  }

  if (ctxError) {
    return (
      <PortalShell orgSlug={orgSlug}>
        <div className="mx-auto w-full max-w-md py-12">
          <Notice variant="error">{t('portal.org.invalid', 'Organization not found.')}</Notice>
        </div>
      </PortalShell>
    )
  }

  return (
    <PortalShell orgSlug={orgSlug} organizationName={organizationName}>
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t('portal.login.title', 'Sign In')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('portal.login.description', 'Enter your credentials to access the portal.')}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error ? <Notice variant="error">{error}</Notice> : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-email" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.login.email', 'Email')}</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              placeholder={t('portal.login.email.placeholder', 'you@example.com')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              className="rounded-lg"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-password" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{t('portal.login.password', 'Password')}</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              placeholder={t('portal.login.password.placeholder', '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              className="rounded-lg"
            />
          </div>

          <Button type="submit" disabled={submitting} className="mt-1 w-full rounded-lg">
            {submitting ? t('portal.login.submitting', 'Signing in...') : t('portal.login.submit', 'Sign In')}
          </Button>

          <p className="text-center text-[13px] text-muted-foreground">
            {t('portal.login.noAccount', "Don't have an account?")}{' '}
            <Link href={`/${orgSlug}/portal/signup`} className="font-medium text-foreground underline underline-offset-4 hover:opacity-80">
              {t('portal.login.signupLink', 'Sign up')}
            </Link>
          </p>
        </form>
      </div>
    </PortalShell>
  )
}
