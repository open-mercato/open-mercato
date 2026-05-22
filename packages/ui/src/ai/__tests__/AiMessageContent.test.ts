/**
 * @jest-environment node
 */

import { parseAiContentSegments } from '../AiMessageContent'

describe('parseAiContentSegments — fenced cards', () => {
  it('parses a properly fenced product card', () => {
    const content = [
      'Here is the product:',
      '```open-mercato:product',
      '{ "id": "abc", "name": "Wireless Headphones", "sku": "WH-001" }',
      '```',
    ].join('\n')
    const segments = parseAiContentSegments(content)
    expect(segments.some((s) => s.kind === 'record-card')).toBe(true)
    const card = segments.find((s) => s.kind === 'record-card')
    expect(card?.kind).toBe('record-card')
    if (card?.kind === 'record-card' && card.payload.kind === 'product') {
      expect(card.payload.name).toBe('Wireless Headphones')
    }
  })
})

describe('parseAiContentSegments — fenceless recovery', () => {
  it('lifts a fenceless single-line product card out of the prose', () => {
    const content =
      'Here are the recent products: ' +
      'open-mercato:product { "id": "c3171e47-9067-424d-8577-6ad25685b69c", "name": "Aurora Wrap Dress", "sku": "AURORA-WRAP", "price": 212, "currency": "USD", "imageUrl": "/api/attachments/image/988b8d93/aurora.png", "href": "/backend/catalog/catalog/products/c3171e47-9067-424d-8577-6ad25685b69c" } ' +
      'and more.'
    const segments = parseAiContentSegments(content)
    const cards = segments.filter((s) => s.kind === 'record-card')
    expect(cards).toHaveLength(1)
    if (cards[0].kind === 'record-card' && cards[0].payload.kind === 'product') {
      expect(cards[0].payload.name).toBe('Aurora Wrap Dress')
      expect(cards[0].payload.sku).toBe('AURORA-WRAP')
      expect(cards[0].payload.imageUrl).toBe('/api/attachments/image/988b8d93/aurora.png')
    }
    // Surrounding prose is preserved
    const md = segments.filter((s) => s.kind === 'markdown')
    expect(md.length).toBeGreaterThanOrEqual(1)
  })

  it('lifts multiple fenceless cards in a row', () => {
    const content = [
      'Products:',
      'open-mercato:product { "id": "1", "name": "Aurora Wrap Dress" }',
      'open-mercato:product { "id": "2", "name": "Atlas Runner Sneaker" }',
      'open-mercato:product { "id": "3", "name": "Restorative Massage" }',
      'Tell me which one to work on next.',
    ].join('\n')
    const segments = parseAiContentSegments(content)
    const cards = segments.filter((s) => s.kind === 'record-card')
    expect(cards).toHaveLength(3)
    const names = cards
      .map((card) => (card.kind === 'record-card' && card.payload.kind === 'product' ? card.payload.name : null))
      .filter(Boolean)
    expect(names).toEqual(['Aurora Wrap Dress', 'Atlas Runner Sneaker', 'Restorative Massage'])
  })

  it('lifts a fenceless multi-line card spanning newlines', () => {
    const content =
      'Here is one:\n' +
      'open-mercato:product\n' +
      '{\n' +
      '  "id": "abc",\n' +
      '  "name": "Aurora Wrap Dress"\n' +
      '}\n' +
      'follow-up text.'
    const segments = parseAiContentSegments(content)
    const cards = segments.filter((s) => s.kind === 'record-card')
    expect(cards).toHaveLength(1)
  })

  it('falls back to plain markdown when the json is invalid', () => {
    const content = 'Maybe: open-mercato:product { not json } end'
    const segments = parseAiContentSegments(content)
    expect(segments.every((s) => s.kind === 'markdown')).toBe(true)
  })

  it('falls back to plain markdown for unknown kinds', () => {
    const content = 'See: open-mercato:bogus { "id": "x", "name": "y" }'
    const segments = parseAiContentSegments(content)
    expect(segments.every((s) => s.kind === 'markdown')).toBe(true)
  })

  it('preserves a properly fenced card when both formats appear', () => {
    const content = [
      'Two products:',
      '```open-mercato:product',
      '{ "id": "1", "name": "Fenced Product" }',
      '```',
      'and: open-mercato:product { "id": "2", "name": "Fenceless Product" }',
    ].join('\n')
    const segments = parseAiContentSegments(content)
    const cards = segments.filter((s) => s.kind === 'record-card')
    expect(cards).toHaveLength(2)
    const names = cards
      .map((card) => (card.kind === 'record-card' && card.payload.kind === 'product' ? card.payload.name : null))
      .filter(Boolean)
    expect(names).toEqual(['Fenced Product', 'Fenceless Product'])
  })

  it('handles nested braces inside the json (e.g. attribute objects)', () => {
    const content =
      'Here: open-mercato:product { "id": "1", "name": "X", "attrs": { "color": "rosewood", "size": "M" } } done'
    const segments = parseAiContentSegments(content)
    const cards = segments.filter((s) => s.kind === 'record-card')
    expect(cards).toHaveLength(1)
  })
})
