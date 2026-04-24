"use client"
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type Props = { params: { orgSlug: string } }

type VerifyState = 'verifying' | 'success' | 'error'

export default function PortalVerifyPage({ params }: Props) {
  const t = useT()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [state, setState] = useState<VerifyState>(token ? 'verifying' : 'error')
  const [error, setError] = useState<string | null>(token ? null : t('portal.verify.error.invalidToken', 'Verification token is missing.'))

  useEffect(() => {
    if (!token) return

    let active = true

    void apiCall<{ ok: boolean; error?: string }>('/api/customer_accounts/email/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then((result) => {
      if (!active) return
      if (result.ok && result.result?.ok) {
        setState('success')
        return
      }

      setState('error')
      setError(result.result?.error || t('portal.verify.error.generic', 'Email verification failed. Please try again.'))
    }).catch(() => {
      if (!active) return
      setState('error')
      setError(t('portal.verify.error.generic', 'Email verification failed. Please try again.'))
    })

    return () => {
      active = false
    }
  }, [token, t])

  if (state === 'verifying') {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 py-12 text-center">
        <Spinner />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('portal.verify.title', 'Verifying email')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('portal.verify.description', 'Please wait while we verify your email address.')}</p>
        </div>
      </div>
    )
  }

  if (state === 'success') {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 py-12 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-foreground text-background">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('portal.verify.success.title', 'Email verified')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('portal.verify.success.description', 'Your email has been verified. You can now sign in to the portal.')}</p>
        </div>
        <Button asChild className="w-full rounded-lg">
          <Link href={`/${params.orgSlug}/portal/login`}>{t('portal.verify.success.loginLink', 'Sign In')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-12">
      <Alert variant="destructive">
        <AlertDescription>{error || t('portal.verify.error.generic', 'Email verification failed. Please try again.')}</AlertDescription>
      </Alert>
      <Button asChild variant="outline" className="rounded-lg">
        <Link href={`/${params.orgSlug}/portal/login`}>{t('portal.verify.error.backToLogin', 'Back to sign in')}</Link>
      </Button>
    </div>
  )
}
