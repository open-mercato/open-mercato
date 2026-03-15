"use client"
import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

export default function OrgPortalLoginPage({ params }: Props) {
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
        setError(t('example.portal.org.invalid'))
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
          setError(t('example.portal.login.error.locked'))
        } else if (res.status === 401) {
          setError(t('example.portal.login.error.invalidCredentials'))
        } else {
          setError(data?.error || t('example.portal.login.error.generic'))
        }
      } catch {
        setError(t('example.portal.login.error.generic'))
      } finally {
        setSubmitting(false)
      }
    },
    [email, password, tenantId, orgSlug, router, t],
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

  return (
    <PortalLayout orgSlug={orgSlug} organizationName={organizationName}>
      <div className="mx-auto w-full max-w-md">
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-semibold tracking-tight">{t('example.portal.login.title')}</h1>
            <CardDescription>{t('example.portal.login.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error ? <Notice variant="error">{error}</Notice> : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-email">{t('example.portal.login.email')}</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder={t('example.portal.login.email.placeholder')}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-password">{t('example.portal.login.password')}</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder={t('example.portal.login.password.placeholder')}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                />
              </div>

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? t('example.portal.login.submitting') : t('example.portal.login.submit')}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {t('example.portal.login.noAccount')}{' '}
                <Link href={`/${orgSlug}/portal/signup`} className="font-medium text-primary underline">
                  {t('example.portal.login.signupLink')}
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
