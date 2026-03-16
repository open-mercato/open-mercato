"use client"
import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard, PortalCardHeader, PortalStatRow, PortalCardDivider } from '@open-mercato/ui/portal/components/PortalCard'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { PortalInjectionSpots } from '@open-mercato/ui/backend/injection/spotIds'

type Props = { params: { orgSlug: string } }

export default function PortalProfilePage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, roles, resolvedFeatures, isPortalAdmin, loading } = auth

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/${params.orgSlug}/portal/login`)
    }
  }, [loading, user, router, params.orgSlug])

  const injectionContext = useMemo(
    () => ({ orgSlug: params.orgSlug, user, roles, resolvedFeatures, isPortalAdmin }),
    [params.orgSlug, user, roles, resolvedFeatures, isPortalAdmin],
  )

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>
  }

  if (!user) return null

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('portal.dashboard.never', 'Never')
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <PortalPageHeader
        label={t('portal.profile.label', 'Account')}
        title={t('portal.profile.title', 'Profile')}
      />

      <InjectionSpot spotId={PortalInjectionSpots.pageBefore('profile')} context={injectionContext} />

      <div className="grid gap-5 md:grid-cols-2">
        <PortalCard>
          <PortalCardHeader label={t('portal.dashboard.profile', 'Profile')} title={user.displayName} />
          <div className="flex flex-col">
            <PortalStatRow
              label={t('portal.dashboard.email', 'Email')}
              value={
                <span className="flex items-center gap-2">
                  <span className="truncate">{user.email}</span>
                  <Badge variant={user.emailVerified ? 'default' : 'outline'} className="shrink-0 text-[10px]">
                    {user.emailVerified ? t('portal.dashboard.emailVerified', 'Verified') : t('portal.dashboard.emailNotVerified', 'Unverified')}
                  </Badge>
                </span>
              }
            />
            <PortalCardDivider />
            <PortalStatRow label={t('portal.dashboard.lastLogin', 'Last login')} value={formatDate(user.lastLoginAt)} />
            <PortalCardDivider />
            <PortalStatRow label={t('portal.dashboard.memberSince', 'Member since')} value={formatDate(user.createdAt)} />
            {isPortalAdmin ? (
              <>
                <PortalCardDivider />
                <PortalStatRow label={t('portal.dashboard.roles', 'Role')} value={<Badge className="text-[10px]">{t('portal.dashboard.portalAdmin', 'Portal Admin')}</Badge>} />
              </>
            ) : null}
          </div>
        </PortalCard>

        <PortalCard>
          <PortalCardHeader label={t('portal.dashboard.roles', 'Roles')} title={`${roles.length} assigned`} />
          {roles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {roles.map((role) => (
                <span key={role.id} className="inline-flex items-center rounded-lg border px-3 py-1.5 text-[12px] font-medium">{role.name}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('portal.dashboard.noRoles', 'No roles assigned')}</p>
          )}
        </PortalCard>

        <PortalCard className="md:col-span-2">
          <PortalCardHeader label={t('portal.dashboard.permissions', 'Permissions')} title={`${resolvedFeatures.length} features`} />
          {resolvedFeatures.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {resolvedFeatures.map((feature) => (
                <span key={feature} className="inline-flex items-center rounded-md border bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">{feature}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('portal.dashboard.noPermissions', 'No permissions')}</p>
          )}
        </PortalCard>
      </div>

      <InjectionSpot spotId={PortalInjectionSpots.pageAfter('profile')} context={injectionContext} />
    </div>
  )
}
