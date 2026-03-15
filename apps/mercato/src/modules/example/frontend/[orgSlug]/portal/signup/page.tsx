"use client"
import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Card, CardContent, CardHeader, CardDescription } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Button } from '@open-mercato/ui/primitives/button'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { PortalLayout } from '../../../portal/components/PortalLayout'
import { useTenantContext } from '../../../portal/components/useTenantContext'

type Props = { params: { orgSlug: string } }

export default function OrgPortalSignupPage({ params }: Props) {
  const t = useT()
  const orgSlug = params.orgSlug
  const { tenantId, organizationId, organizationName, loading: ctxLoading, error: ctxError } = useTenantContext(orgSlug)

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

      if (!tenantId || !organizationId) {
        setError(t('example.portal.org.invalid'))
        return
      }

      setSubmitting(true)
      try {
        const res = await fetch('/api/customer_accounts/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, password, displayName, tenantId, organizationId }),
        })

        const data = await res.json().catch(() => null)

        if (res.status === 201 && data?.ok) {
          setSuccess(true)
          return
        }

        setError(data?.error || t('example.portal.signup.error.generic'))
      } catch {
        setError(t('example.portal.signup.error.generic'))
      } finally {
        setSubmitting(false)
      }
    },
    [displayName, email, password, tenantId, organizationId, t],
  )

  if (ctxLoading) {
    return (
      <PortalLayout orgSlug={orgSlug}>
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      </PortalLayout>
    )
  }

  if (ctxError) {
    return (
      <PortalLayout orgSlug={orgSlug}>
        <div className="mx-auto w-full max-w-md py-12">
          <Notice variant="error">{t('example.portal.org.invalid')}</Notice>
        </div>
      </PortalLayout>
    )
  }

  if (success) {
    return (
      <PortalLayout orgSlug={orgSlug} organizationName={organizationName}>
        <div className="mx-auto w-full max-w-md">
          <Card>
            <CardHeader>
              <h1 className="text-2xl font-semibold tracking-tight">
                {t('example.portal.signup.success.title')}
              </h1>
              <CardDescription>{t('example.portal.signup.success.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href={`/${orgSlug}/portal/login`}>{t('example.portal.signup.success.loginLink')}</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout orgSlug={orgSlug} organizationName={organizationName}>
      <div className="mx-auto w-full max-w-md">
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-semibold tracking-tight">{t('example.portal.signup.title')}</h1>
            <CardDescription>{t('example.portal.signup.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error ? <Notice variant="error">{error}</Notice> : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-name">{t('example.portal.signup.displayName')}</Label>
                <Input
                  id="signup-name"
                  type="text"
                  autoComplete="name"
                  required
                  placeholder={t('example.portal.signup.displayName.placeholder')}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-email">{t('example.portal.signup.email')}</Label>
                <Input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder={t('example.portal.signup.email.placeholder')}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-password">{t('example.portal.signup.password')}</Label>
                <Input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  placeholder={t('example.portal.signup.password.placeholder')}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                />
              </div>

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? t('example.portal.signup.submitting') : t('example.portal.signup.submit')}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {t('example.portal.signup.hasAccount')}{' '}
                <Link href={`/${orgSlug}/portal/login`} className="font-medium text-primary underline">
                  {t('example.portal.signup.loginLink')}
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
