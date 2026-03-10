'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import MfaSettingsRedirect from '../../../components/MfaSettingsRedirect'
import PasswordChangeForm from '../../../components/PasswordChangeForm'

export default function SecurityProfilePage() {
  return (
    <Page>
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <PasswordChangeForm />

          <div className="space-y-4">
            <MfaSettingsRedirect />
            <InjectionSpot
              spotId="security.profile.sidebar"
              context={{ section: 'sidebar' }}
            />
          </div>
        </div>

        <div className="mt-6">
          <InjectionSpot
            spotId="security.profile.sections"
            context={{ section: 'profile-sections' }}
          />
        </div>
      </PageBody>
    </Page>
  )
}
