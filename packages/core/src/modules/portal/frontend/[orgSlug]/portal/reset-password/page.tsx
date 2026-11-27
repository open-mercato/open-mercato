"use client"
import { useMemo } from 'react'
import { extensionPoints } from '@open-mercato/core/modules/portal/extension-points'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { PortalPasswordForm } from '../PasswordForm'

export default function PortalResetPasswordPage({ params }: { params: { orgSlug: string } }) {
  const orgSlug = params.orgSlug
  const injectionContext = useMemo(() => ({ orgSlug }), [orgSlug])
  return (
    <PortalPasswordForm
      params={params}
      beforeForm={<InjectionSpot spotId={extensionPoints.hosts.resetPasswordBefore.spotId} context={injectionContext} />}
      afterForm={<InjectionSpot spotId={extensionPoints.hosts.resetPasswordAfter.spotId} context={injectionContext} />}
    />
  )
}
