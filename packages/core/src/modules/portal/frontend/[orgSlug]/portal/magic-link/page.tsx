"use client"
import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { replaceWithPageReload } from '@open-mercato/core/modules/portal/lib/navigation'

type Props = { params: { orgSlug: string } }

export default function PortalMagicLinkPage({ params }: Props) {
  const t = useT()
  const orgSlug = params.orgSlug
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(
    token ? null : t('portal.magicLink.error.missingToken', 'Sign-in link is invalid or incomplete.'),
  )

  const handleSignIn = useCallback(async () => {
    if (!token) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await apiCall<{ ok: boolean; error?: string }>('/api/customer_accounts/magic-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token }),
      })
      if (result.ok && result.result?.ok) {
        replaceWithPageReload(`/${orgSlug}/portal/dashboard`)
        return
      }
      setError(t('portal.magicLink.error.invalidToken', 'This sign-in link is invalid or has expired. Request a new one.'))
    } catch {
      setError(t('portal.magicLink.error.generic', 'Sign-in failed. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }, [token, orgSlug, t])

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 py-12">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t('portal.magicLink.title', 'Sign in with a link')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t('portal.magicLink.description', 'Continue to sign in to the portal with the link from your email.')}
        </p>
      </div>
      {error ? (
        <Alert status="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {token ? (
        <Button type="button" onClick={() => void handleSignIn()} disabled={submitting} className="w-full rounded-lg">
          {submitting ? <Spinner /> : null}
          {t('portal.magicLink.submit', 'Sign in')}
        </Button>
      ) : null}
      <Button asChild variant="outline" className="rounded-lg">
        <Link href={`/${orgSlug}/portal/login`}>{t('portal.magicLink.backToLogin', 'Back to sign in')}</Link>
      </Button>
    </div>
  )
}
