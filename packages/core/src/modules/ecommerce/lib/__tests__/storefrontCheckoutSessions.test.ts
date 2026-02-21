import { describe, expect, it } from '@jest/globals'
import type { EcommerceCheckoutSession } from '../../data/entities'
import {
  getAllowedCheckoutActions,
  isSessionExpired,
} from '../storefrontCheckoutSessions'

function createSession(
  overrides: Partial<EcommerceCheckoutSession> = {},
): EcommerceCheckoutSession {
  return {
    status: 'active',
    workflowState: 'cart',
    expiresAt: new Date('2026-02-21T12:00:00.000Z'),
    ...overrides,
  } as EcommerceCheckoutSession
}

describe('storefrontCheckoutSessions', () => {
  describe('getAllowedCheckoutActions', () => {
    it('returns cart actions for active cart state', () => {
      const session = createSession({ workflowState: 'cart' })
      expect(getAllowedCheckoutActions(session)).toEqual(['set_customer', 'cancel'])
    })

    it('returns review actions for active review state', () => {
      const session = createSession({ workflowState: 'review' })
      expect(getAllowedCheckoutActions(session)).toEqual(['review', 'place_order', 'cancel'])
    })

    it('returns empty actions for non-active sessions', () => {
      const session = createSession({ status: 'completed', workflowState: 'review' })
      expect(getAllowedCheckoutActions(session)).toEqual([])
    })

    it('returns place_order only while placing_order is in progress', () => {
      const session = createSession({ workflowState: 'placing_order' })
      expect(getAllowedCheckoutActions(session)).toEqual(['place_order'])
    })
  })

  describe('isSessionExpired', () => {
    it('returns false when expiry is in the future', () => {
      const session = createSession({
        expiresAt: new Date('2026-02-21T12:30:00.000Z'),
      })
      expect(isSessionExpired(session, new Date('2026-02-21T12:00:00.000Z'))).toBe(false)
    })

    it('returns true when now matches expiry exactly', () => {
      const session = createSession({
        expiresAt: new Date('2026-02-21T12:00:00.000Z'),
      })
      expect(isSessionExpired(session, new Date('2026-02-21T12:00:00.000Z'))).toBe(true)
    })

    it('returns true when expiry is in the past', () => {
      const session = createSession({
        expiresAt: new Date('2026-02-21T11:59:59.000Z'),
      })
      expect(isSessionExpired(session, new Date('2026-02-21T12:00:00.000Z'))).toBe(true)
    })
  })
})
