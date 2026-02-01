'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionPage, type SectionNavGroup } from '@open-mercato/ui/backend/section-page'

const KeyIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
)

const sections: SectionNavGroup[] = [
  {
    id: 'account',
    label: 'Account',
    labelKey: 'profile.sections.account',
    order: 1,
    items: [
      {
        id: 'change-password',
        label: 'Change Password',
        labelKey: 'auth.changePassword.title',
        href: '/backend/profile/change-password',
        icon: KeyIcon,
        order: 1,
      },
    ],
  },
]

export default function ProfilePage() {
  const t = useT()

  return (
    <SectionPage
      title="Profile"
      titleKey="profile.page.title"
      sections={sections}
      activePath="/backend/profile"
    >
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">{t('profile.page.title', 'Profile')}</h1>
        <p className="text-muted-foreground mb-6">
          {t('profile.page.description', 'Manage your account settings')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('profile.page.selectItem', 'Select an item from the menu to manage your account.')}
        </p>
      </div>
    </SectionPage>
  )
}
