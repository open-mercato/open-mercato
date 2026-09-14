import { MAX_USER_LOOKUP_IDS, resolveUserIdFilter } from '../lib/userIdFilter'

const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'
const CAROL = '33333333-3333-4333-8333-333333333333'

describe('resolveUserIdFilter', () => {
  it('leaves the list unfiltered when neither id nor ids is supplied', () => {
    expect(resolveUserIdFilter(undefined)).toEqual({ kind: 'unfiltered' })
    expect(resolveUserIdFilter(null, null)).toEqual({ kind: 'unfiltered' })
  })

  it('keeps the single-id contract intact', () => {
    expect(resolveUserIdFilter(undefined, ALICE)).toEqual({ kind: 'ids', ids: [ALICE] })
  })

  it('parses a comma-separated batch, dropping non-UUIDs and duplicates', () => {
    const result = resolveUserIdFilter(`${ALICE},not-a-uuid,${BOB},${ALICE}`)

    expect(result).toEqual({ kind: 'ids', ids: [ALICE, BOB] })
  })

  it('intersects ids with id rather than widening to both', () => {
    expect(resolveUserIdFilter(`${ALICE},${BOB}`, ALICE)).toEqual({ kind: 'ids', ids: [ALICE] })
  })

  it('matches nothing when ids was supplied but no value survived validation', () => {
    // Dropping the filter here would answer a malformed request with the full first page,
    // turning it into a record-count side channel.
    expect(resolveUserIdFilter('not-a-uuid,also-not')).toEqual({ kind: 'none' })
    expect(resolveUserIdFilter(',,,')).toEqual({ kind: 'none' })
  })

  it('matches nothing when id falls outside the requested batch', () => {
    expect(resolveUserIdFilter(`${ALICE},${BOB}`, CAROL)).toEqual({ kind: 'none' })
  })

  it('caps the batch at the lookup limit', () => {
    const ids = Array.from({ length: MAX_USER_LOOKUP_IDS + 25 }, (_, index) => {
      const suffix = index.toString(16).padStart(12, '0')
      return `44444444-4444-4444-8444-${suffix}`
    })

    const result = resolveUserIdFilter(ids.join(','))

    expect(result.kind).toBe('ids')
    expect(result.kind === 'ids' && result.ids).toHaveLength(MAX_USER_LOOKUP_IDS)
  })

  it('treats a whitespace-only ids value as not supplied', () => {
    expect(resolveUserIdFilter('   ')).toEqual({ kind: 'unfiltered' })
    expect(resolveUserIdFilter('   ', ALICE)).toEqual({ kind: 'ids', ids: [ALICE] })
  })
})
