import {
  advanceXeroCursor,
  completeXeroFullPass,
  emptyXeroCursor,
  parseXeroCursor,
  planXeroWalk,
  serializeXeroCursor,
  type XeroCursor,
} from '../lib/cursor'
import { floorToSecond, keysetFilterBefore, parseXeroDate } from '../lib/dates'

const ORG = '996096ec-5362-40dd-be90-3e6a2be09dce'
const OTHER_ORG = '1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6'

function cursor(overrides: Partial<XeroCursor> = {}): XeroCursor {
  return { ...emptyXeroCursor(ORG), ...overrides }
}

describe('xero cursor', () => {
  it('round-trips through serialization and keeps only its own keys', () => {
    const value = cursor({ modifiedSince: '2026-10-01T10:00:00.000Z', lastFullAt: '2026-09-30T00:00:00.000Z', lastFullCalls: 3 })
    const raw = serializeXeroCursor(value)
    expect(parseXeroCursor(raw, ORG)).toEqual(value)
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual([
      'fullPassModifiedSince',
      'fullPassStartedAt',
      'lastFullAt',
      'lastFullCalls',
      'modifiedSince',
      'v',
      'xeroOrganisationId',
    ])
  })

  it('treats an unparsable cursor, a cursor of another Organisation and an unknown version as no cursor', () => {
    expect(parseXeroCursor('not json', ORG)).toBeNull()
    expect(parseXeroCursor(null, ORG)).toBeNull()
    expect(parseXeroCursor(serializeXeroCursor(cursor()), OTHER_ORG)).toBeNull()
    expect(parseXeroCursor(JSON.stringify({ ...cursor(), v: 2 }), ORG)).toBeNull()
    expect(parseXeroCursor(JSON.stringify({ ...cursor(), modifiedSince: 'yesterday' }), ORG)).toBeNull()
  })
})

describe('planXeroWalk', () => {
  it('starts a full pass from the start of Xero order without a usable cursor', () => {
    expect(planXeroWalk({ cursor: null, xeroOrganisationId: ORG, fullSync: false })).toMatchObject({ kind: 'full', startAfter: null, resumed: false })
  })

  it('walks incrementally from the cursor keyset', () => {
    const plan = planXeroWalk({ cursor: cursor({ modifiedSince: '2026-10-01T10:00:05.700Z' }), xeroOrganisationId: ORG, fullSync: false })
    expect(plan.kind).toBe('incremental')
    expect(plan.startAfter?.toISOString()).toBe('2026-10-01T10:00:05.700Z')
  })

  it('resumes a pass in progress from its own keyset, also on a manual run', () => {
    const inPass = cursor({ modifiedSince: '2026-09-01T00:00:00.000Z', fullPassStartedAt: '2026-10-01T09:00:00.000Z', fullPassModifiedSince: '2026-01-02T03:04:05.000Z' })
    const plan = planXeroWalk({ cursor: inPass, xeroOrganisationId: ORG, fullSync: false })
    expect(plan).toMatchObject({ kind: 'full', resumed: true })
    expect(plan.startAfter?.toISOString()).toBe('2026-01-02T03:04:05.000Z')
  })

  it('ignores the cursor for an explicit full sync', () => {
    const plan = planXeroWalk({ cursor: cursor({ modifiedSince: '2026-10-01T10:00:00.000Z' }), xeroOrganisationId: ORG, fullSync: true })
    expect(plan).toMatchObject({ kind: 'full', startAfter: null, resumed: false })
  })
})

describe('cursor progress', () => {
  it('moves the incremental keyset to the last record of a page', () => {
    const plan = planXeroWalk({ cursor: cursor({ modifiedSince: '2026-10-01T10:00:00.000Z' }), xeroOrganisationId: ORG, fullSync: false })
    const next = advanceXeroCursor(plan, plan.cursor, { lastUpdatedAt: new Date('2026-10-01T11:00:00.250Z'), passStartedAt: null })
    expect(next).toMatchObject({ modifiedSince: '2026-10-01T11:00:00.250Z', fullPassStartedAt: null })
  })

  it('records the pass start and keyset during a full pass, keeping the pre-pass keyset', () => {
    const plan = planXeroWalk({ cursor: null, xeroOrganisationId: ORG, fullSync: false })
    const next = advanceXeroCursor(plan, plan.cursor, {
      lastUpdatedAt: new Date('2025-05-05T05:05:05.000Z'),
      passStartedAt: new Date('2026-10-13T10:00:00.000Z'),
    })
    expect(next).toMatchObject({
      modifiedSince: null,
      fullPassStartedAt: '2026-10-13T10:00:00.000Z',
      fullPassModifiedSince: '2025-05-05T05:05:05.000Z',
    })
  })

  it('commits lastFullAt = modifiedSince = the pass start once the pass drains, clearing the pass fields', () => {
    const inPass = cursor({ fullPassStartedAt: '2026-10-13T10:00:00.000Z', fullPassModifiedSince: '2026-10-13T09:59:00.000Z' })
    expect(completeXeroFullPass(inPass, { passStartedAt: new Date('2026-10-14T00:00:00.000Z'), calls: 7 })).toEqual({
      ...inPass,
      modifiedSince: '2026-10-13T10:00:00.000Z',
      lastFullAt: '2026-10-13T10:00:00.000Z',
      fullPassStartedAt: null,
      fullPassModifiedSince: null,
      fullPassChunk: null,
      lastFullCalls: 7,
    })
  })
})

describe('xero dates', () => {
  it.each([
    ['/Date(1539993600000+0000)/', '2018-10-20T00:00:00.000Z'],
    ['/Date(1552326816230)/', '2019-03-11T17:53:36.230Z'],
    ['/Date(1552326816230-0500)/', '2019-03-11T17:53:36.230Z'],
    ['2026-10-01T10:00:00', '2026-10-01T10:00:00.000Z'],
    ['2026-10-01T10:00:00.5Z', '2026-10-01T10:00:00.500Z'],
  ])('parses %s', (value, expected) => {
    expect(parseXeroDate(value)?.toISOString()).toBe(expected)
  })

  it('rejects anything else', () => {
    expect(parseXeroDate('soon')).toBeNull()
    expect(parseXeroDate(42)).toBeNull()
  })

  it('builds the keyset filter one second earlier, at second precision', () => {
    expect(keysetFilterBefore(new Date('2026-10-01T10:00:05.700Z')).toISOString()).toBe('2026-10-01T10:00:04.000Z')
    expect(floorToSecond(new Date('2026-10-01T10:00:05.999Z')).toISOString()).toBe('2026-10-01T10:00:05.000Z')
  })
})
