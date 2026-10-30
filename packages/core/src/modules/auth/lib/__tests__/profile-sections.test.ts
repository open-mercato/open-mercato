import { resolvePageRouteMetadata } from '@open-mercato/shared/modules/registry'
import {
  buildAdminNav,
  buildProfileSections,
  mergeSectionsWithDiscovered,
} from '@open-mercato/ui/backend/utils/nav'
import { metadata as changePasswordMetadata } from '@open-mercato/core/modules/auth/backend/profile/change-password/page.meta'
import { metadata as communicationChannelsMetadata } from '@open-mercato/core/modules/communication_channels/backend/profile/communication-channels/page.meta'
import { metadata as notificationPreferencesMetadata } from '@open-mercato/core/modules/notifications/backend/profile/notification-preferences/page.meta'
import { profileSections } from '../profile-sections'

// Mirrors `profileSectionOrder` in backendChrome.tsx; kept literal so this test does not have to
// pull the whole chrome payload module (and its container/ORM imports) into a nav-shape assertion.
const profileSectionOrder = { 'profile.sections.account': 1 }

const profileModules = [
  {
    id: 'auth',
    backendRoutes: [
      resolvePageRouteMetadata('/backend/profile/change-password', changePasswordMetadata),
    ],
  },
  {
    id: 'communication_channels',
    backendRoutes: [
      resolvePageRouteMetadata('/backend/profile/communication-channels', communicationChannelsMetadata),
    ],
  },
  {
    id: 'notifications',
    backendRoutes: [
      resolvePageRouteMetadata('/backend/profile/notification-preferences', notificationPreferencesMetadata),
    ],
  },
]

async function resolveSections(grantedFeatures: string[]) {
  const entries = await buildAdminNav(
    profileModules,
    { auth: { roles: [] } },
    undefined,
    undefined,
    { checkFeatures: async (features) => features.filter((feature) => grantedFeatures.includes(feature)) },
  )
  return mergeSectionsWithDiscovered(profileSections, buildProfileSections(entries, profileSectionOrder))
}

describe('profile sidebar sections', () => {
  // Regression for GH #5594: the profile sidebar rendered a hard-coded list, so the per-user pages
  // other modules contribute were reachable from the profile dropdown but not from the sidebar.
  it('lists every profile-context page the profile dropdown offers, in one Account section', async () => {
    const sections = await resolveSections([
      'communication_channels.connect_user_channel',
      'notifications.manage_preferences',
    ])

    expect(sections.map((section) => section.id)).toEqual(['profile.sections.account'])
    expect(sections[0].items.map((item) => item.href)).toEqual([
      '/backend/profile/change-password',
      '/backend/profile/communication-channels',
      '/backend/profile/notification-preferences',
    ])
  })

  it('omits a profile page whose feature the user was not granted', async () => {
    const sections = await resolveSections(['notifications.manage_preferences'])

    expect(sections[0].items.map((item) => item.href)).toEqual([
      '/backend/profile/change-password',
      '/backend/profile/notification-preferences',
    ])
  })

  it('keeps the change-password baseline entry, which route discovery hides', async () => {
    const sections = await resolveSections([])

    expect(sections[0].items.map((item) => item.href)).toEqual([
      '/backend/profile/change-password',
    ])
  })
})
