"use client"
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { PortalShell } from '@open-mercato/ui/portal/PortalShell'
import { useTenantContext } from '@open-mercato/ui/portal/hooks/useTenantContext'
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard, PortalCardHeader, PortalStatRow, PortalCardDivider } from '@open-mercato/ui/portal/components/PortalCard'

type Props = { params: { orgSlug: string } }

export default function PortalProfilePage({ params }: Props) {
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
      <PortalShell orgSlug={orgSlug} authenticated>
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

  if (!user) return null

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('portal.dashboard.never', 'Never')
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <PortalShell
      orgSlug={orgSlug}
      organizationName={organizationName}
      authenticated
      onLogout={logout}
      userName={user.displayName}
      userEmail={user.email}
    >
      <div className="flex flex-col gap-8">
        <PortalPageHeader
          label={t('portal.profile.label', 'Account')}
          title={t('portal.profile.title', 'Profile')}
        />

        <div className="grid gap-5 md:grid-cols-2">
          {/* Profile card */}
          <PortalCard>
            <PortalCardHeader label={t('portal.dashboard.profile', 'Profile')} title={user.displayName} />
            <div className="flex flex-col">
              <PortalStatRow
                label={t('portal.dashboard.email', 'Email')}
                value={
                  <span className="flex items-center gap-2">
                    <span className="truncate">{user.email}</span>
                    <Badge variant={user.emailVerified ? 'default' : 'outline'} className="shrink-0 text-[10px]">
                      {user.emailVerified
                        ? t('portal.dashboard.emailVerified', 'Verified')
                        : t('portal.dashboard.emailNotVerified', 'Unverified')}
                    </Badge>
                  </span>
                }
              />
              <PortalCardDivider />
              <PortalStatRow
                label={t('portal.dashboard.lastLogin', 'Last login')}
                value={formatDate(user.lastLoginAt)}
              />
              <PortalCardDivider />
              <PortalStatRow
                label={t('portal.dashboard.memberSince', 'Member since')}
                value={formatDate(user.createdAt)}
              />
              {isPortalAdmin ? (
                <>
                  <PortalCardDivider />
                  <PortalStatRow
                    label={t('portal.dashboard.roles', 'Role')}
                    value={<Badge className="text-[10px]">{t('portal.dashboard.portalAdmin', 'Portal Admin')}</Badge>}
                  />
                </>
              ) : null}
            </div>
          </PortalCard>

          {/* Roles card */}
          <PortalCard>
            <PortalCardHeader label={t('portal.dashboard.roles', 'Roles')} title={`${roles.length} assigned`} />
            {roles.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => (
                  <span
                    key={role.id}
                    className="inline-flex items-center rounded-lg border px-3 py-1.5 text-[12px] font-medium"
                  >
                    {role.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('portal.dashboard.noRoles', 'No roles assigned')}</p>
            )}
          </PortalCard>

          {/* Permissions card */}
          <PortalCard className="md:col-span-2">
            <PortalCardHeader label={t('portal.dashboard.permissions', 'Permissions')} title={`${resolvedFeatures.length} features`} />
            {resolvedFeatures.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {resolvedFeatures.map((feature) => (
                  <span
                    key={feature}
                    className="inline-flex items-center rounded-md border bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground"
                  >
                    {feature}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('portal.dashboard.noPermissions', 'No permissions')}</p>
            )}
          </PortalCard>
        </div>
      </div>
    </PortalShell>
  )
}
