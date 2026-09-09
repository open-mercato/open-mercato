import {
  COLLABORATION_COLOR_FALLBACK,
  createCanonicalCollaborationAwarenessUser,
  normalizeCollaborationColor,
  sanitizeCollaborationAwarenessName,
} from '../lib/collaborationAwareness'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ENCRYPTED_NAME = 'YWJjZGVmZ2hpamts:ZG9jdW1lbnRzLXVzZXI=:bW9jay1hdXRoLXRhZw==:v1'

describe('collaboration awareness boundary', () => {
  it('accepts only canonical six-digit hex colors', () => {
    expect(normalizeCollaborationColor('#ABC123')).toBe('#abc123')
    expect(normalizeCollaborationColor('#fff')).toBe(COLLABORATION_COLOR_FALLBACK)
    expect(normalizeCollaborationColor('red')).toBe(COLLABORATION_COLOR_FALLBACK)
    expect(normalizeCollaborationColor('var(--primary)')).toBe(COLLABORATION_COLOR_FALLBACK)
    expect(normalizeCollaborationColor(
      '#fff;background-image:url(https://attacker.invalid)',
    )).toBe(COLLABORATION_COLOR_FALLBACK)
  })

  it('rejects names that can conceal or spoof an awareness identity', () => {
    expect(sanitizeCollaborationAwarenessName('  Ada Lovelace  ')).toBe('Ada Lovelace')
    expect(sanitizeCollaborationAwarenessName(`User ${USER_ID}`)).toBe('')
    expect(sanitizeCollaborationAwarenessName('Admin\u202ereyalp')).toBe('')
    expect(sanitizeCollaborationAwarenessName('Admin\nUser')).toBe('')
    expect(sanitizeCollaborationAwarenessName(ENCRYPTED_NAME)).toBe('')
    expect(sanitizeCollaborationAwarenessName('a'.repeat(121))).toBe('')
  })

  it('creates a stable server-owned awareness identity', () => {
    const first = createCanonicalCollaborationAwarenessUser(USER_ID, 'Ada Lovelace')
    const second = createCanonicalCollaborationAwarenessUser(USER_ID, 'Ada Lovelace')

    expect(first).toEqual(second)
    expect(first).toMatchObject({ id: USER_ID, name: 'Ada Lovelace' })
    expect(first.color).toMatch(/^#[0-9a-f]{6}$/)
  })
})
