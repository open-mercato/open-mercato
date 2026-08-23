import { participantActorKey } from '../participantIdentity'

describe('participantActorKey', () => {
  it('keys a participant with a record on its userId', () => {
    expect(participantActorKey({ userId: 'user-1', email: 'staff@example.org' })).toBe('user:user-1')
  })

  it('keys a guest on its normalized email', () => {
    expect(participantActorKey({ email: '  Guest@Example.ORG ' })).toBe('email:guest@example.org')
  })

  it('never lets a guest email collide with a userId key', () => {
    expect(participantActorKey({ userId: 'guest@example.org' })).not.toBe(
      participantActorKey({ email: 'guest@example.org' }),
    )
  })

  it('returns null for a participant identified by neither', () => {
    expect(participantActorKey({ name: 'Nobody' } as { userId?: string; email?: string })).toBeNull()
    expect(participantActorKey({ email: '   ' })).toBeNull()
  })
})
