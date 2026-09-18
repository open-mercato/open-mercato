/**
 * `findSidebarPreference` must distinguish "no saved preference" from "preference exists but is
 * empty".
 *
 * `backendChrome` layers role defaults beneath the user layout and guards the user pass with
 * `userPreference ? applySidebarPreference(...) : baseForUser`. `applySidebarPreference`
 * overwrites `hidden` rather than OR-ing it, so an empty user settings object silently wipes
 * every role-level hide and the role group order. The loader therefore has to return `null`
 * when no row exists — otherwise that guard can never take its else-branch and role-level
 * layout is lost for every user who has not personally customised their sidebar.
 *
 * `loadSidebarPreference` is the deprecated bridge that preserves the old non-nullable contract
 * for third-party callers; its behaviour is pinned here too so the compatibility promise itself
 * stays under test until the removal in 0.9.0.
 */
import {
  findSidebarPreference,
  loadSidebarPreference,
} from '@open-mercato/core/modules/auth/services/sidebarPreferencesService'
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
  } as unknown as Parameters<typeof findSidebarPreference>[0]
}

const tenantA = '11111111-1111-1111-1111-111111111111'
const userA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const orgA = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const scopeA = { userId: userA, tenantId: tenantA, organizationId: orgA, locale: 'en' }

describe('findSidebarPreference', () => {
  beforeEach(() => {
    findOneMock.mockReset()
  })

  it('returns null when the user has no saved preference row', async () => {
    findOneMock.mockResolvedValueOnce(null)
    expect(await findSidebarPreference(makeMockEm(), scopeA)).toBeNull()
  })

  it('returns normalized settings when a row exists', async () => {
    findOneMock.mockResolvedValueOnce({
      id: 'pref-1',
      settingsJson: { version: 2, hiddenItems: ['catalog-products'], groupOrder: ['catalog.nav.group'] },
    })

    const settings = await findSidebarPreference(makeMockEm(), scopeA)

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

    const settings = await findSidebarPreference(makeMockEm(), scopeA)

    expect(settings).not.toBeNull()
    expect(settings?.hiddenItems).toEqual([])
    expect(settings?.groupOrder).toEqual([])
  })

  it('keeps the user + tenant + organization scope on the lookup', async () => {
    findOneMock.mockResolvedValueOnce(null)

    await findSidebarPreference(makeMockEm(), scopeA)

    const [, , filter, , decryptionScope] = findOneMock.mock.calls[0]
    expect(filter).toMatchObject({ user: userA, tenantId: tenantA, organizationId: orgA })
    expect(decryptionScope).toEqual({ tenantId: tenantA, organizationId: orgA })
  })
})

describe('loadSidebarPreference (deprecated bridge)', () => {
  beforeEach(() => {
    findOneMock.mockReset()
  })

  it('still returns non-null default settings when no row exists', async () => {
    // The compatibility promise: a third-party caller written against the pre-0.7.1 contract
    // reads `.hiddenItems` off this result without a null check and must keep working.
    findOneMock.mockResolvedValueOnce(null)

    const settings = await loadSidebarPreference(makeMockEm(), scopeA)

    expect(settings).not.toBeNull()
    expect(settings.hiddenItems).toEqual([])
    expect(settings.groupOrder).toEqual([])
    expect(settings.groupLabels).toEqual({})
    expect(settings.itemLabels).toEqual({})
    expect(settings.itemOrder).toEqual({})
  })

  it('passes a saved row through unchanged', async () => {
    findOneMock.mockResolvedValueOnce({
      id: 'pref-1',
      settingsJson: { version: 2, hiddenItems: ['catalog-products'] },
    })

    const settings = await loadSidebarPreference(makeMockEm(), scopeA)

    expect(settings).toMatchObject({ version: 2, hiddenItems: ['catalog-products'] })
  })
})
