import { asValue, createContainer } from 'awilix'
import { loadTierThresholds } from '../tiers'
import { DEFAULT_TIER_THRESHOLDS } from '../engine/tiers'
import { loadProductUrlTemplate } from '../recommendations'
import { DEFAULT_WINNER_METRIC, loadWinnerMetric } from '../winner-metric'

/**
 * The per-tenant config reads, and the one mistake they invite.
 *
 * `moduleConfigService.getValue` takes the scope inside an OPTIONS object while `setValue` takes it
 * positionally. Both loaders passed it positionally, so every tenant-scoped value was written per tenant
 * and read instance-wide — silently, because falling back to the default is a legitimate answer. These
 * tests assert the scope ARRIVES, which is the only way that failure is visible.
 */

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

type Recorded = { moduleId: string; name: string; options: unknown }

function containerWithConfig(value: unknown, recorded: Recorded[] = []) {
  const container = createContainer()
  container.register({
    moduleConfigService: asValue({
      async getValue(moduleId: string, name: string, options?: unknown) {
        recorded.push({ moduleId, name, options })
        return value
      },
    }),
  })
  return container
}

describe('loadTierThresholds', () => {
  it('asks for the value with the scope inside the options object', async () => {
    const recorded: Recorded[] = []
    await loadTierThresholds(containerWithConfig(null, recorded), scope)
    expect(recorded).toHaveLength(1)
    expect(recorded[0].moduleId).toBe('marketing_automation')
    expect(recorded[0].options).toEqual({ scope })
  })

  it('returns the configured ladder, normalised', async () => {
    const container = containerWithConfig([
      { key: 'gold', minPoints: 500 },
      { key: 'bronze', minPoints: 0 },
    ])
    expect(await loadTierThresholds(container, scope)).toEqual([
      { key: 'bronze', minPoints: 0 },
      { key: 'gold', minPoints: 500 },
    ])
  })

  it('falls back to the defaults when nothing is configured', async () => {
    expect(await loadTierThresholds(containerWithConfig(null), scope)).toEqual(DEFAULT_TIER_THRESHOLDS)
  })

  it('falls back to the defaults in a process with no config service at all', async () => {
    expect(await loadTierThresholds(createContainer(), scope)).toEqual(DEFAULT_TIER_THRESHOLDS)
  })
})

describe('loadProductUrlTemplate', () => {
  it('asks for the value with the scope inside the options object', async () => {
    const recorded: Recorded[] = []
    await loadProductUrlTemplate(containerWithConfig(null, recorded), scope)
    expect(recorded[0].options).toEqual({ scope })
  })

  it('returns the template', async () => {
    const container = containerWithConfig('https://shop.example/p/{sku}')
    expect(await loadProductUrlTemplate(container, scope)).toBe('https://shop.example/p/{sku}')
  })

  it('refuses a template that could not name a product', async () => {
    // Stored by an older version, or typed without the placeholder: it would link every product to the
    // same page, which looks like it works.
    expect(await loadProductUrlTemplate(containerWithConfig('https://shop.example/products'), scope)).toBeNull()
    expect(await loadProductUrlTemplate(containerWithConfig(''), scope)).toBeNull()
    expect(await loadProductUrlTemplate(containerWithConfig(42), scope)).toBeNull()
  })

  it('answers null in a process with no config service', async () => {
    expect(await loadProductUrlTemplate(createContainer(), scope)).toBeNull()
  })
})

describe('loadWinnerMetric', () => {
  it('asks for the value with the scope inside the options object', async () => {
    const recorded: Recorded[] = []
    await loadWinnerMetric(containerWithConfig(null, recorded), scope)
    expect(recorded[0].name).toBe('splitWinnerMetric')
    expect(recorded[0].options).toEqual({ scope })
  })

  it('returns revenue when a tenant has chosen it', async () => {
    expect(await loadWinnerMetric(containerWithConfig('revenue'), scope)).toBe('revenue')
  })

  /**
   * Anything unrecognised is clicks, not an error and not the stored string.
   *
   * The value reaches `pickSplitWinner`, and a third metric that no branch handles would silently rank on
   * nothing. Defaulting means a value written by a later version degrades to the answer that always works.
   */
  it('treats anything else as clicks', async () => {
    expect(await loadWinnerMetric(containerWithConfig('clicks'), scope)).toBe('clicks')
    expect(await loadWinnerMetric(containerWithConfig('profit'), scope)).toBe(DEFAULT_WINNER_METRIC)
    expect(await loadWinnerMetric(containerWithConfig(null), scope)).toBe(DEFAULT_WINNER_METRIC)
    expect(await loadWinnerMetric(containerWithConfig(true), scope)).toBe(DEFAULT_WINNER_METRIC)
  })

  it('answers the default in a process with no config service', async () => {
    expect(await loadWinnerMetric(createContainer(), scope)).toBe(DEFAULT_WINNER_METRIC)
  })
})
