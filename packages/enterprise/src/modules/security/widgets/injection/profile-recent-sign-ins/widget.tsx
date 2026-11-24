'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link.js'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SignInDevice, SignInNewDeviceBadge, SignInReason, SignInResultBadge, SignInTime, type ProfileSignIn } from '../../../components/SignInDisplay'

type RecentSignInsState = { items: ProfileSignIn[] } | 'hidden' | 'error' | null

function ProfileRecentSignIns() {
  const t = useT()
  const [state, setState] = useState<RecentSignInsState>(null)

  useEffect(() => {
    const controller = new AbortController()
    void apiCall<{ items: ProfileSignIn[] }>('/api/security/profile/sign-ins', { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        if (response.status === 404 || response.status === 403) setState('hidden')
        else if (response.ok && response.result) setState(response.result)
        else setState('error')
      })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [])

  if (!state || state === 'hidden') return null
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>{t('security.signIns.profile.title')}</h2></CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === 'error' && <ErrorMessage label={t('security.signIns.errors.profile')} />}
        {typeof state === 'object' && state.items.length === 0 && <EmptyState title={t('security.signIns.profile.empty')} />}
        {typeof state === 'object' && state.items.length > 0 && (
          <ul className="divide-y divide-border">
            {state.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <SignInDevice item={item} icon />
                    {item.isNewDevice ? <SignInNewDeviceBadge /> : null}
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                    {item.ipAddress && <span>{item.ipAddress}</span>}
                    <SignInTime value={item.occurredAt} />
                    {item.result === 'failure' && item.reason && <SignInReason reason={item.reason} />}
                  </div>
                </div>
                <SignInResultBadge result={item.result} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{t('security.signIns.profile.unrecognised')}</span>
          <a className="font-medium text-foreground underline underline-offset-4" href="#security-password-change-form">
            {t('security.signIns.profile.changePassword')}
          </a>
          <Link className="font-medium text-foreground underline underline-offset-4" href="/backend/profile/security/mfa">
            {t('security.signIns.profile.reviewMfa')}
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

const widgetModule: InjectionWidgetModule = {
  metadata: {
    id: 'security.injection.profile-recent-sign-ins',
    title: 'Recent sign-ins',
    features: ['security.profile.view'],
    priority: 500,
    enabled: true,
  },
  Widget: ProfileRecentSignIns,
}

export default widgetModule
