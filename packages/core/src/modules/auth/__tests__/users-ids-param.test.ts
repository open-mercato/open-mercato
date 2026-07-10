/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { parseRequestedIds } from '@open-mercato/core/modules/auth/api/users/route'

describe('parseRequestedIds', () => {
  it('splits on commas and trims whitespace around tokens', () => {
    const first = randomUUID()
    const second = randomUUID()
    expect(parseRequestedIds(` ${first} , ${second} `)).toEqual([first, second])
  })

  it('drops tokens that are not valid UUIDs', () => {
    const valid = randomUUID()
    expect(parseRequestedIds(`not-a-uuid,${valid},123,,${valid.slice(0, 8)}`)).toEqual([valid])
  })

  it('caps the result at 100 ids', () => {
    const ids = Array.from({ length: 150 }, () => randomUUID())
    const parsed = parseRequestedIds(ids.join(','))
    expect(parsed).toHaveLength(100)
    expect(parsed).toEqual(ids.slice(0, 100))
  })

  it('returns an empty array for undefined, empty, and blank input', () => {
    expect(parseRequestedIds(undefined)).toEqual([])
    expect(parseRequestedIds('')).toEqual([])
    expect(parseRequestedIds('   ')).toEqual([])
    expect(parseRequestedIds(',,,')).toEqual([])
  })
})
