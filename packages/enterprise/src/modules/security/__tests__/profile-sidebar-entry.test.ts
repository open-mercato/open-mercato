import { resolvePageRouteMetadata } from '@open-mercato/shared/modules/registry'
import { buildAdminNav, buildProfileSections } from '@open-mercato/ui/backend/utils/nav'
import { metadata as securityProfileMetadata } from '@open-mercato/enterprise/modules/security/backend/profile/security/page.meta'
import { metadata as mfaMetadata } from '@open-mercato/enterprise/modules/security/backend/profile/security/mfa/page.meta'
import securityDropdownWidget from '@open-mercato/enterprise/modules/security/widgets/injection/profile-dropdown-security-item/widget'

const securityModule = [
  {
    id: 'security',
    backendRoutes: [
      resolvePageRouteMetadata('/backend/profile/security', securityProfileMetadata),
      resolvePageRouteMetadata('/backend/profile/security/mfa', mfaMetadata),
    ],
  },
]

async function resolveProfileSections(grantedFeatures: string[]) {
  const entries = await buildAdminNav(
    securityModule,
    { auth: { roles: [] } },
    undefined,
    undefined,
    { checkFeatures: async (features) => features.filter((feature) => grantedFeatures.includes(feature)) },
  )
  return buildProfileSections(entries, { 'profile.sections.account': 1 })
}

describe('security profile sidebar entry', () => {
  // Regression for GH #5594: the profile dropdown offered "Security & MFA" while the profile
  // sidebar did not, because the page was navHidden and declared no profile page context.
  it('reaches the profile sidebar under the shared account section', async () => {
    const sections = await resolveProfileSections(['security.profile.view'])

    expect(sections.map((section) => section.id)).toEqual(['profile.sections.account'])
    expect(sections[0].items.map((item) => item.href)).toEqual(['/backend/profile/security'])
  })

  it('points at the same route as the profile dropdown item, under the same feature', async () => {
    const dropdownItem = securityDropdownWidget.menuItems?.[0]

    expect(dropdownItem?.href).toBe('/backend/profile/security')
    expect(dropdownItem?.features).toEqual(securityProfileMetadata.requireFeatures)
  })

  it('stays hidden from users without the security profile feature', async () => {
    const sections = await resolveProfileSections([])

    expect(sections).toEqual([])
  })

  it('keeps the MFA sub-pages out of the sidebar', async () => {
    const sections = await resolveProfileSections(['security.profile.view'])
    const hrefs = sections.flatMap((section) => section.items.map((item) => item.href))

    expect(hrefs).not.toContain('/backend/profile/security/mfa')
  })
})
