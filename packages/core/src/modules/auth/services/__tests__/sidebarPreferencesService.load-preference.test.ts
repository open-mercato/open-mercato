/**
 * `loadSidebarPreference` must distinguish "no saved preference" from "preference exists but is
 * empty".
 *
 * `backendChrome` layers role defaults beneath the user layout and guards the user pass with
 * `userPreference ? applySidebarPreference(...) : baseForUser`. `applySidebarPreference`
 * overwrites `hidden` rather than OR-ing it, so an empty user settings object silently wipes
 * every role-level hide and the role group order. The loader therefore has to return `null`
 * when no row exists — otherwise that guard can never take its else-branch and role-level
 * layout is lost for every user who has not personally customised their sidebar.
 */
import { loadSidebarPreference } from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
import * as encryptionFind from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

const findOneMock = encryptionFind.findOneWithDecryption as jest.Mock

function makeMockEm() {
  return {
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => 0),
    getReference: jest.fn((_e, id) => ({ id })),
    create: jest.fn(),
  } as unknown as Parameters<typeof loadSidebarPreference>[0]
}

const tenantA = '11111111-1111-1111-1111-111111111111'
const userA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const orgA = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const scopeA = { userId: userA, tenantId: tenantA, organizationId: orgA, locale: 'en' }

describe('loadSidebarPreference', () => {
  beforeEach(() => {
    findOneMock.mockReset()
  })

  it('returns null when the user has no saved preference row', async () => {
    findOneMock.mockResolvedValueOnce(null)
    expect(await loadSidebarPreference(makeMockEm(), scopeA)).toBeNull()
  })

  it('returns normalized settings when a row exists', async () => {
    findOneMock.mockResolvedValueOnce({
      id: 'pref-1',
      settingsJson: { version: 2, hiddenItems: ['catalog-products'], groupOrder: ['catalog.nav.group'] },
    })

    const settings = await loadSidebarPreference(makeMockEm(), scopeA)

    expect(settings).not.toBeNull()
    expect(settings).toMatchObject({
      version: 2,
      hiddenItems: ['catalog-products'],
      groupOrder: ['catalog.nav.group'],
      groupLabels: {},
      itemLabels: {},
      itemOrder: {},
    })
  })

  it('returns non-null empty settings when the row exists but holds no customization', async () => {
    // "Exists but empty" is a real user choice (they cleared their layout) and must stay
    // distinguishable from "absent" — this one still applies over the role layer.
    findOneMock.mockResolvedValueOnce({ id: 'pref-1', settingsJson: {} })

    const settings = await loadSidebarPreference(makeMockEm(), scopeA)

    expect(settings).not.toBeNull()
    expect(settings?.hiddenItems).toEqual([])
    expect(settings?.groupOrder).toEqual([])
  })

  it('keeps the user + tenant + organization scope on the lookup', async () => {
    findOneMock.mockResolvedValueOnce(null)

    await loadSidebarPreference(makeMockEm(), scopeA)

    const [, , filter, , decryptionScope] = findOneMock.mock.calls[0]
    expect(filter).toMatchObject({ user: userA, tenantId: tenantA, organizationId: orgA })
    expect(decryptionScope).toEqual({ tenantId: tenantA, organizationId: orgA })
  })
})
