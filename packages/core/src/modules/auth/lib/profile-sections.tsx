import * as React from 'react'
import type { SectionNavGroup } from '@open-mercato/ui/backend/section-page'

const KeyIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
)

const AccessibilityIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="16" cy="4" r="1" />
    <path d="m18 19 1-7-6 1" />
    <path d="m5 8 6-2 3 4.5" />
    <path d="M4.24 14.5a5 5 0 0 0 6.88 6" />
    <path d="M13.76 17.5a5 5 0 0 0-6.88-6" />
  </svg>
)

export const profileSections: SectionNavGroup[] = [
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
      {
        id: 'accessibility',
        label: 'Accessibility',
        labelKey: 'auth.accessibility.section_title',
        href: '/backend/profile/accessibility',
        icon: AccessibilityIcon,
        order: 2,
      },
    ],
  },
]

export const profilePathPrefixes = [
  '/backend/profile/',
]

export function isProfilePath(path: string): boolean {
  if (path === '/backend/profile') return true
  return profilePathPrefixes.some((prefix) => path.startsWith(prefix))
}
