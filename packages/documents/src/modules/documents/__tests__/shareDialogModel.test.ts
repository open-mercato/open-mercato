import { readShareItems } from '../backend/documents/components/shareDialogModel'

const SHARE_ID = '11111111-1111-4111-8111-111111111111'
const PRINCIPAL_ID = '22222222-2222-4222-8222-222222222222'
const UUID_V7 = '018f22d4-7c10-7a12-8b34-1234567890ab'
const UUID_V8 = '018f22d4-7c10-8a12-cb34-1234567890ab'

describe('share dialog model', () => {
  it('renders resolved labels while keeping principal identifiers out of visible fields', () => {
    const [share] = readShareItems({
      items: [{
        id: SHARE_ID,
        principal_id: PRINCIPAL_ID,
        principal_type: 'user',
        principal_label: 'Ada Lovelace',
        principal_secondary: 'ada@example.com',
        permission: 'editor',
      }],
    }, 'Removed principal')

    expect(share).toMatchObject({
      id: SHARE_ID,
      principalId: PRINCIPAL_ID,
      principalLabel: 'Ada Lovelace',
      principalSecondary: 'ada@example.com',
      resolved: true,
      permission: 'editor',
    })
  })

  it('uses the removed-principal label instead of exposing UUID-shaped labels or secondary text', () => {
    const [share] = readShareItems({
      shares: [{
        id: SHARE_ID,
        principalId: PRINCIPAL_ID,
        principalLabel: PRINCIPAL_ID,
        principalSecondary: PRINCIPAL_ID,
        permission: 'viewer',
      }],
    }, 'Removed principal')

    expect(share.principalLabel).toBe('Removed principal')
    expect(share.principalSecondary).toBeNull()
    expect(share.resolved).toBe(false)
  })

  it.each([UUID_V7, UUID_V8])(
    'redacts newer and non-legacy UUID variants from principal fallbacks (%s)',
    (guid) => {
      const [share] = readShareItems({
        items: [{
          id: SHARE_ID,
          principalId: PRINCIPAL_ID,
          principalLabel: guid,
          principalSecondary: guid,
          permission: 'viewer',
        }],
      }, 'Removed principal')

      expect(share.principalLabel).toBe('Removed principal')
      expect(share.principalSecondary).toBeNull()
      expect(share.resolved).toBe(false)
    },
  )

  it('redacts an identifier embedded inside otherwise readable principal fields', () => {
    const [share] = readShareItems({
      items: [{
        id: SHARE_ID,
        principalId: PRINCIPAL_ID,
        principalType: 'role',
        principalLabel: `Sales team ${UUID_V7}`,
        principalSecondary: `Directory ${UUID_V8}`,
        permission: 'viewer',
      }],
    }, 'Removed principal')

    expect(share).toMatchObject({
      principalLabel: 'Removed principal',
      principalSecondary: null,
      resolved: false,
    })
  })
})
