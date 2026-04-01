'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export default function PreparingPageClient() {
  const t = useT()
  const translate = (key: string, fallback: string, params?: Record<string, string | number>) =>
    translateWithFallback(t, key, fallback, params)
  const searchParams = useSearchParams()
  const tenantId = (searchParams.get('tenant') || '').trim()
  const [tenantName, setTenantName] = useState<string | null>(null)

  useEffect(() => {
    if (!tenantId) {
      setTenantName(null)
      return
    }
    let active = true
    apiCall<{ ok?: boolean; tenant?: { id: string; name: string } }>(
      `/api/directory/tenants/lookup?tenantId=${encodeURIComponent(tenantId)}`,
    )
      .then(({ result }) => {
        if (!active) return
        setTenantName(result?.ok && result.tenant ? result.tenant.name : null)
      })
      .catch(() => {
        if (!active) return
        setTenantName(null)
      })
    return () => {
      active = false
    }
  }, [tenantId])

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted/40 px-4 pb-24">
      <Card className="relative w-full max-w-lg overflow-hidden shadow-lg">
        <CardHeader className="flex flex-col gap-4 p-10 text-center">
          <div className="flex flex-col items-center gap-4">
            <Image alt="Open Mercato" src="/open-mercato.svg" width={120} height={120} priority />
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-foreground/5">
              <Spinner size="lg" />
            </span>
            <CardTitle className="text-2xl font-semibold">
              {translate('onboarding.preparing.title', 'We are preparing your workspace')}
            </CardTitle>
            <CardDescription className="max-w-md text-balance">
              {tenantName
                ? translate(
                    'onboarding.preparing.descriptionWithTenant',
                    'We are finishing the demo environment for {tenant}. We will send you an email with the correct tenant login link as soon as it is ready.',
                    { tenant: tenantName },
                  )
                : translate(
                    'onboarding.preparing.description',
                    'We are finishing your demo environment. We will send you an email with the correct tenant login link as soon as it is ready.',
                  )}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pb-10 text-center">
          <div className="rounded-xl border border-border/70 bg-background/80 px-4 py-4 text-sm text-muted-foreground">
            {translate(
              'onboarding.preparing.emailNotice',
              'You do not need to keep this page open. We will email you when everything is ready.',
            )}
          </div>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild variant="outline">
              <Link href="/onboarding">
                {translate('onboarding.preparing.backCta', 'Back to onboarding')}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/">
                {translate('onboarding.preparing.homeCta', 'Go to home page')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
