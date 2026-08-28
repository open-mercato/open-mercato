import * as React from 'react'
import type { SettingsSection } from '@open-mercato/ui/backend/utils/nav'

const KeyIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
)

/**
 * Baseline profile sidebar sections for pages route discovery cannot see.
 *
 * `/backend/profile/change-password` is `navHidden`, so `buildAdminNav` drops it and
 * `buildProfileSections` can never derive it. Everything else in the profile sidebar comes from
 * pages declaring `pageContext: 'profile'` and is merged in by `resolveBackendChromePayload`.
 *
 * The section id is the untranslated group id (`profile.sections.account`) — the same convention the
 * settings sidebar adopted in 0.6.8 — so a page declaring `pageGroupKey: 'profile.sections.account'`
 * lands in this section instead of opening a duplicate one.
 */
export const profileSections: SettingsSection[] = [
  {
    id: 'profile.sections.account',
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

export const profilePathPrefixes = [
  '/backend/profile/',
]

export function isProfilePath(path: string): boolean {
  if (path === '/backend/profile') return true
  return profilePathPrefixes.some((prefix) => path.startsWith(prefix))
}
