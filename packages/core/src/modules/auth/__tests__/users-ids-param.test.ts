/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import {
  MAX_REQUESTED_IDS,
  buildRequestedIdsFilter,
} from '@open-mercato/core/modules/auth/api/users/route'

describe('auth users ?ids= narrowing', () => {
  it('splits on commas and trims whitespace around tokens', () => {
    const first = randomUUID()
    const second = randomUUID()
    expect(parseIdsParam(` ${first} , ${second} `, MAX_REQUESTED_IDS)).toEqual([first, second])
  })

  it('drops tokens that are not valid UUIDs', () => {
    const valid = randomUUID()
    expect(
      parseIdsParam(`not-a-uuid,${valid},123,,${valid.slice(0, 8)}`, MAX_REQUESTED_IDS),
    ).toEqual([valid])
  })

  it('collapses repeated ids so one id cannot consume the whole budget', () => {
    const repeated = randomUUID()
    expect(parseIdsParam(Array.from({ length: 150 }, () => repeated).join(','), MAX_REQUESTED_IDS))
      .toEqual([repeated])
  })

  it('caps the result at the route budget', () => {
    const ids = Array.from({ length: MAX_REQUESTED_IDS + 50 }, () => randomUUID())
    const parsed = parseIdsParam(ids.join(','), MAX_REQUESTED_IDS)
    expect(parsed).toHaveLength(MAX_REQUESTED_IDS)
    expect(parsed).toEqual(ids.slice(0, MAX_REQUESTED_IDS))
  })

  it('accepts the array shape produced by interceptor-merged query params', () => {
    const first = randomUUID()
    const second = randomUUID()
    expect(parseIdsParam([first, second], MAX_REQUESTED_IDS)).toEqual([first, second])
  })

  it('returns an empty array for undefined, empty, and blank input', () => {
    expect(parseIdsParam(undefined, MAX_REQUESTED_IDS)).toEqual([])
    expect(parseIdsParam('', MAX_REQUESTED_IDS)).toEqual([])
    expect(parseIdsParam('   ', MAX_REQUESTED_IDS)).toEqual([])
    expect(parseIdsParam(',,,', MAX_REQUESTED_IDS)).toEqual([])
  })
})

describe('buildRequestedIdsFilter', () => {
  it('adds no filter when the caller omitted ids', () => {
    expect(buildRequestedIdsFilter(undefined)).toBeNull()
    expect(buildRequestedIdsFilter('')).toBeNull()
    expect(buildRequestedIdsFilter('   ')).toBeNull()
  })

  it('narrows to the requested ids when they are valid', () => {
    const first = randomUUID()
    const second = randomUUID()
    expect(buildRequestedIdsFilter(`${first},${second}`)).toEqual({ id: { $in: [first, second] } })
  })

  it('narrows to nothing when a supplied ids param yields no valid uuid', () => {
    expect(buildRequestedIdsFilter('not-a-uuid')).toEqual({ id: { $in: [] } })
    expect(buildRequestedIdsFilter(',,,')).toEqual({ id: { $in: [] } })
  })
})
