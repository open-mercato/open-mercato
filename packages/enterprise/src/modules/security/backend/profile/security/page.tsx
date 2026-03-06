'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import PasswordChangeForm from '../../../components/PasswordChangeForm'

export default function SecurityProfilePage() {
  const t = useT()

  return (
    <Page>
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <section className="space-y-4 rounded-lg border bg-background p-6">
            <PasswordChangeForm />
          </section>

          <aside className="space-y-4">
            <section className="rounded-lg border bg-background p-4">
              <h3 className="text-sm font-medium">
                {t('security.profile.mfa.title', 'Multi-factor authentication')}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(
                  'security.profile.mfa.description',
                  'Manage your MFA methods and recovery codes.',
                )}
              </p>
              <Button type="button" asChild size="sm" className="mt-3">
                <Link href="/backend/profile/security/mfa">
                  {t('security.profile.mfa.manage', 'Manage MFA settings')}
                </Link>
              </Button>
            </section>
            <InjectionSpot
              spotId="security.profile.sidebar"
              context={{ section: 'sidebar' }}
            />
          </aside>
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
