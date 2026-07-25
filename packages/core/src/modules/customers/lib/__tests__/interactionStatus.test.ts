import {
  INTERACTION_STATUS_CANCELED,
  INTERACTION_STATUS_COMPLETED,
  INTERACTION_STATUS_PLANNED,
  TERMINAL_INTERACTION_STATUS_LIST,
  isOpenInteractionStatus,
  isTerminalInteractionStatus,
} from '../interactionStatus'

describe('interaction status semantics', () => {
  describe('isTerminalInteractionStatus', () => {
    it.each(['done', 'canceled', 'completed'])('treats %s as terminal', (value) => {
      expect(isTerminalInteractionStatus(value)).toBe(true)
    })

    it.each(['planned', 'in_progress', 'waiting'])('treats seeded open status %s as not terminal', (value) => {
      expect(isTerminalInteractionStatus(value)).toBe(false)
    })

    it('treats an unknown/custom status as not terminal (open by default)', () => {
      expect(isTerminalInteractionStatus('blocked_by_legal')).toBe(false)
    })

    it('treats null/undefined as not terminal', () => {
      expect(isTerminalInteractionStatus(null)).toBe(false)
      expect(isTerminalInteractionStatus(undefined)).toBe(false)
    })
  })

  describe('isOpenInteractionStatus', () => {
    it.each(['planned', 'in_progress', 'waiting', 'blocked_by_legal'])('treats %s as open', (value) => {
      expect(isOpenInteractionStatus(value)).toBe(true)
    })

    it.each(['done', 'canceled', 'completed'])('treats terminal status %s as not open', (value) => {
      expect(isOpenInteractionStatus(value)).toBe(false)
    })

    it('treats null/undefined as open', () => {
      expect(isOpenInteractionStatus(null)).toBe(true)
      expect(isOpenInteractionStatus(undefined)).toBe(true)
    })
  })

  it('exposes the canonical status constants', () => {
    expect(INTERACTION_STATUS_COMPLETED).toBe('done')
    expect(INTERACTION_STATUS_CANCELED).toBe('canceled')
    expect(INTERACTION_STATUS_PLANNED).toBe('planned')
  })

  it('lists every terminal status', () => {
    expect([...TERMINAL_INTERACTION_STATUS_LIST].sort()).toEqual(['canceled', 'completed', 'done'])
  })
})
