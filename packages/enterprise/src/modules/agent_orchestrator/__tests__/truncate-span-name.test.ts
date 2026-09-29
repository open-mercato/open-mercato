/**
 * Trace span rows truncated at the tail, so eight different MCP tool spans all
 * rendered as the same prefix followed by an ellipsis. The distinguishing part
 * of a tool name is its SUFFIX, which is exactly what was cut.
 */
import { truncateSpanName } from '../lib/trace/spanTimeline'

describe('truncateSpanName', () => {
  it('leaves a short name alone', () => {
    expect(truncateSpanName('llm.step')).toBe('llm.step')
  })

  it('keeps the suffix that tells two tool spans apart', () => {
    const leftSource = 'open-mercato_search_deductible_config'
    const rightSource = 'open-mercato_search_premium_schedule'
    const left = truncateSpanName(leftSource)
    const right = truncateSpanName(rightSource)
    // Tail-truncation rendered these two as the SAME string.
    expect(left).not.toBe(right)
    // As much of the tail as the budget allows survives, cut at the middle.
    expect(left.endsWith(leftSource.slice(-12))).toBe(true)
    expect(right.endsWith(rightSource.slice(-12))).toBe(true)
    expect(left.startsWith('open')).toBe(true)
  })

  it('never exceeds the budget', () => {
    const truncated = truncateSpanName('a'.repeat(200))
    expect(truncated.length).toBeLessThanOrEqual(26)
    expect(truncated).toContain('…')
  })

  it('honours an explicit budget', () => {
    expect(truncateSpanName('abcdefghijklmnop', 10).length).toBeLessThanOrEqual(10)
  })
})
