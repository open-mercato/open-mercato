import {
  normalizeCollabTokenPayload,
  readCollaborationPresence,
} from '../backend/documents/[id]/useDocumentCollaboration'
import {
  resolveCollaborationCaretColor,
  resolveCollaborationCaretLabel,
} from '../lib/editorConfig'
import {
  COLLABORATION_COLOR_FALLBACK,
  resolveCollaborationUserColor,
} from '../lib/collaborationAwareness'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222'
const ENCRYPTED_NAME = 'YWJjZGVmZ2hpamts:ZG9jdW1lbnRzLXVzZXI=:bW9jay1hdXRoLXRhZw==:v1'

describe('collaboration display labels', () => {
  it('replaces UUID-shaped token names with the localized neutral label', () => {
    const token = normalizeCollabTokenPayload({
      token: 'signed-token',
      documentId: DOCUMENT_ID,
      tier: 'editor',
      expiresInSec: 60,
      canEdit: true,
      readOnly: false,
      user: { id: USER_ID, name: `User ${USER_ID}`, color: '#123456' },
    }, 'Unknown user')

    expect(token?.user.name).toBe('Unknown user')
    expect(JSON.stringify(token?.user)).not.toContain(`User ${USER_ID}`)
  })

  it('derives token colors from the authenticated user instead of CSS-capable payloads', () => {
    const token = normalizeCollabTokenPayload({
      token: 'signed-token',
      documentId: DOCUMENT_ID,
      tier: 'editor',
      expiresInSec: 60,
      canEdit: true,
      readOnly: false,
      user: {
        id: USER_ID,
        name: 'Readable collaborator',
        color: '#fff;background-image:url(https://attacker.invalid)',
      },
    }, 'Unknown user')

    expect(token?.user.color).toBe(resolveCollaborationUserColor(USER_ID))
    expect(JSON.stringify(token?.user)).not.toContain('attacker.invalid')
  })

  it('replaces encrypted token names with the localized neutral label', () => {
    const token = normalizeCollabTokenPayload({
      token: 'signed-token',
      documentId: DOCUMENT_ID,
      tier: 'editor',
      expiresInSec: 60,
      canEdit: true,
      readOnly: false,
      user: { id: USER_ID, name: ENCRYPTED_NAME, color: '#123456' },
    }, 'Unknown user')

    expect(token?.user.name).toBe('Unknown user')
    expect(JSON.stringify(token?.user)).not.toContain(ENCRYPTED_NAME)
  })

  it('never renders client-controlled awareness UUID names', () => {
    const provider = {
      document: { clientID: 1 },
      awareness: {
        getStates: () => new Map<number, unknown>([
          [1, { user: { name: 'Local user', color: '#000000' } }],
          [2, { user: { name: `Remote ${USER_ID}`, color: '#123456' } }],
          [3, {
            user: {
              id: '33333333-3333-4333-8333-333333333333',
              name: 'Readable collaborator',
              color: '#fff;background-image:url(https://attacker.invalid)',
            },
          }],
          [4, { user: { name: 'Admin\u202ereyalp', color: '#112233' } }],
          [5, { user: { name: ENCRYPTED_NAME, color: '#334455' } }],
        ]),
      },
    }

    const users = readCollaborationPresence(provider as never, 'Unknown user')

    expect(users.map((user) => user.name)).toEqual([
      'Unknown user',
      'Readable collaborator',
      'Unknown user',
      'Unknown user',
    ])
    expect(users[1]?.color).toBe(resolveCollaborationUserColor(
      '33333333-3333-4333-8333-333333333333',
    ))
    expect(JSON.stringify(users)).not.toContain(USER_ID)
    expect(JSON.stringify(users)).not.toContain('attacker.invalid')
    expect(JSON.stringify(users)).not.toContain(ENCRYPTED_NAME)
    expect(resolveCollaborationCaretLabel(
      { name: `Remote ${USER_ID}`, color: '#123456' },
      'Unknown user',
    )).toBe('Unknown user')
    expect(resolveCollaborationCaretLabel(
      { name: ENCRYPTED_NAME, color: '#123456' },
      'Unknown user',
    )).toBe('Unknown user')
    expect(resolveCollaborationCaretColor({
      color: '#fff;background-image:url(https://attacker.invalid)',
    })).toBe(COLLABORATION_COLOR_FALLBACK)
  })
})
