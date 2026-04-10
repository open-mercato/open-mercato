import { getCachedResponse, setCacheEnabled, isCacheEnabled, loadResponseCache } from '../response-cache'

describe('ResponseCache', () => {
  beforeEach(() => {
    setCacheEnabled(false)
  })

  it('returns null when cache is disabled', () => {
    const result = getCachedResponse(1)
    expect(result).toBeNull()
  })

  it('returns suggestions when cache is enabled and segmentId matches', () => {
    const mockSuggestions = [
      {
        id: 'sug_1',
        type: 'quick_action' as const,
        priority: 'high' as const,
        triggerText: 'test',
        triggerSegmentId: 5,
        matchConfidence: 90,
        createdAt: Date.now(),
        actions: [{ label: 'Test', actionType: 'add_note' as const, prefill: {} }],
      },
    ]

    loadResponseCache([{ segmentId: 5, suggestions: mockSuggestions }])
    expect(isCacheEnabled()).toBe(true)

    const result = getCachedResponse(5)
    expect(result).toEqual(mockSuggestions)
  })

  it('toggles cache on and off', () => {
    setCacheEnabled(true)
    expect(isCacheEnabled()).toBe(true)

    setCacheEnabled(false)
    expect(isCacheEnabled()).toBe(false)
  })
})
