"use client"
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Card, CardContent, CardHeader } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { PortalLayout } from '../../../portal/components/PortalLayout'
import { useTenantContext } from '../../../portal/components/useTenantContext'
import { useCustomerAuth } from '../../../portal/components/useCustomerAuth'

type Props = { params: { orgSlug: string } }

export default function OrgPortalDashboardPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const orgSlug = params.orgSlug
  const { organizationName, loading: ctxLoading, error: ctxError } = useTenantContext(orgSlug)
  const { user, roles, resolvedFeatures, isPortalAdmin, loading, logout } = useCustomerAuth(orgSlug)

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/${orgSlug}/portal/login`)
    }
  }, [loading, user, router, orgSlug])

  if (ctxLoading || loading) {
    return (
      <PortalLayout orgSlug={orgSlug} authenticated>
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

  if (!user) {
    return null
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('example.portal.dashboard.never')
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <PortalLayout orgSlug={orgSlug} organizationName={organizationName} authenticated onLogout={logout}>
      <h1 className="text-3xl font-bold tracking-tight">
        {t('example.portal.dashboard.welcome', { name: user.displayName })}
      </h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">{t('example.portal.dashboard.profile')}</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('example.portal.dashboard.email')}</span>
              <span className="flex items-center gap-2">
                {user.email}
                <Badge variant={user.emailVerified ? 'default' : 'secondary'}>
                  {user.emailVerified
                    ? t('example.portal.dashboard.emailVerified')
                    : t('example.portal.dashboard.emailNotVerified')}
                </Badge>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('example.portal.dashboard.lastLogin')}</span>
              <span>{formatDate(user.lastLoginAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('example.portal.dashboard.memberSince')}</span>
              <span>{formatDate(user.createdAt)}</span>
            </div>
            {isPortalAdmin ? (
              <div className="pt-1">
                <Badge variant="default">{t('example.portal.dashboard.portalAdmin')}</Badge>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">{t('example.portal.dashboard.roles')}</h2>
          </CardHeader>
          <CardContent>
            {roles.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => (
                  <Badge key={role.id} variant="outline">
                    {role.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('example.portal.dashboard.noRoles')}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <h2 className="text-lg font-semibold">{t('example.portal.dashboard.permissions')}</h2>
          </CardHeader>
          <CardContent>
            {resolvedFeatures.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {resolvedFeatures.map((feature) => (
                  <Badge key={feature} variant="secondary" className="font-mono text-xs">
                    {feature}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('example.portal.dashboard.noPermissions')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={logout}>
          {t('example.portal.dashboard.logout')}
        </Button>
      </div>
    </PortalLayout>
  )
}
