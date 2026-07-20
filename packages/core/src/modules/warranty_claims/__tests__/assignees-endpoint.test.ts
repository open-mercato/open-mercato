/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import {
  MAX_ASSIGNEE_LOOKUP_IDS,
  metadata,
  parseRequestedIds,
} from '@open-mercato/core/modules/warranty_claims/api/assignees/route'

describe('warranty_claims assignee lookup guard', () => {
  it('is gated on a warranty_claims feature and never on an auth.* grant', () => {
    expect(metadata.GET.requireAuth).toBe(true)
    expect(metadata.GET.requireFeatures).toEqual(['warranty_claims.claim.view'])
    for (const feature of metadata.GET.requireFeatures) {
      expect(feature.startsWith('warranty_claims.')).toBe(true)
    }
  })
})

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

  it('collapses repeated ids so one id cannot consume the whole budget', () => {
    const repeated = randomUUID()
    expect(parseRequestedIds(Array.from({ length: 150 }, () => repeated).join(','))).toEqual([repeated])
  })

  it('caps the result at the lookup budget', () => {
    const ids = Array.from({ length: MAX_ASSIGNEE_LOOKUP_IDS + 50 }, () => randomUUID())
    const parsed = parseRequestedIds(ids.join(','))
    expect(parsed).toHaveLength(MAX_ASSIGNEE_LOOKUP_IDS)
    expect(parsed).toEqual(ids.slice(0, MAX_ASSIGNEE_LOOKUP_IDS))
  })

  it('returns an empty array for blank or separator-only input, so a blank ids= cannot list the directory', () => {
    expect(parseRequestedIds('')).toEqual([])
    expect(parseRequestedIds('   ')).toEqual([])
    expect(parseRequestedIds(',,,')).toEqual([])
  })
})
