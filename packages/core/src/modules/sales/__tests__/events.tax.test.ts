import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eventsConfig } from '../events'

describe('sales tax events', () => {
  const ids = eventsConfig.events.map((event) => event.id)

  it('declares the tax provider stage events and excludes them from triggers', () => {
    for (const id of ['sales.tax.adjustments.apply.before', 'sales.tax.adjustments.apply.after']) {
      const event = eventsConfig.events.find((candidate) => candidate.id === id)
      expect(event).toBeDefined()
      expect(event?.category).toBe('lifecycle')
      expect(event?.excludeFromTriggers).toBe(true)
    }
  })

  it('keeps every pre-existing event id, so no consumer breaks', () => {
    for (const id of [
      'sales.document.totals.calculated',
      'sales.shipping.adjustments.apply.before',
      'sales.payment.adjustments.apply.after',
      'sales.order.confirmed',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('declares the optional tax block on the totals payload', () => {
    const totals = eventsConfig.events.find(
      (event) => event.id === 'sales.document.totals.calculated'
    )
    const paths = (totals?.payloadSchema?.fields ?? []).map((field) => field.path)
    expect(paths).toContain('tax')
    expect(paths).toContain('tax.providerKey')
    expect(paths).toContain('tax.status')
    expect(paths).toContain('tax.transactionRef')
    expect(paths).toContain('tax.calculatedAt')
    for (const field of totals?.payloadSchema?.fields ?? []) {
      if (field.path.startsWith('tax')) expect(field.optional).toBe(true)
    }
  })

  it('sends the tax block from every totals emission site', () => {
    const source = readFileSync(join(__dirname, '..', 'commands', 'documents.ts'), 'utf8')
    const emissions = source.match(/await emitTotalsCalculated\(eventBus, \{/g) ?? []
    const blocks = source.match(/tax: taxEventBlock\(calculation\),/g) ?? []
    expect(emissions.length).toBeGreaterThanOrEqual(12)
    expect(blocks.length).toBe(emissions.length)
  })
})
