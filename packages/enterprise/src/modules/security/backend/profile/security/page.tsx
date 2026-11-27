'use client'

import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { cn } from '@open-mercato/shared/lib/utils'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { extensionPoints } from '@open-mercato/enterprise/modules/security/extension-points'
import MfaSettingsRedirect from '../../../components/MfaSettingsRedirect'
import PasswordChangeForm from '../../../components/PasswordChangeForm'

export default function SecurityProfilePage() {
  const { payload } = useBackendChrome()
  const canChangePassword = hasFeature(payload?.grantedFeatures, 'security.profile.password')

  return (
    <Page>
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {canChangePassword ? <PasswordChangeForm /> : null}

          <div className={cn('space-y-4', !canChangePassword && 'lg:col-span-2')}>
            <MfaSettingsRedirect />
            <InjectionSpot
              spotId={extensionPoints.hosts.profileSidebar.spotId}
              context={{ section: 'sidebar' }}
            />
          </div>
        </div>

        <div className="mt-6">
          <InjectionSpot
            spotId={extensionPoints.hosts.profileSections.spotId}
            context={{ section: 'profile-sections' }}
          />
        </div>
      </PageBody>
    </Page>
  )
}
