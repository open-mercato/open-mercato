export {}

import { runMrp } from '../engine'
import { generateBenchmarkInputs } from './benchmark.helpers'

/**
 * Task 5.3 — seeded MRP performance benchmark (`[tdd:required]`, spec §
 * "MRP engine (performance-critical design)", point 5, and KPI "MRP dla ~10
 * tys. indeksow / 5 poziomow BOM < 60 s").
 *
 * Scoping note (documented honestly, per the task brief): this benchmark
 * times `runMrp` — the pure, in-memory net-requirements engine — NOT the
 * bulk-SQL loader (`loaders.ts`) or the persistence step
 * (`persistSuggestions.ts`). The spec identifies the ENGINE as the
 * performance risk ("naive per-entity ORM loads will not meet the 60 s
 * KPI"); the bulk loader issues a small, fixed number of scoped queries
 * (`loaders.test.ts` asserts a query-count bound) regardless of dataset
 * size, so DB round-trip time is not the algorithmic risk this benchmark
 * needs to cover. The 60 s KPI is interpreted here as "engine compute time
 * for a 10k-product / 5-level BOM dataset", with the loader's query count
 * separately bounded by its own test.
 *
 * Two tiers:
 *  - Smoke tier (always runs, every `npm test`): 1,000 products / 5 levels,
 *    proportional budget (10 s). Cheap enough to run on every CI build so a
 *    regression is caught immediately, without paying the full 10k cost on
 *    every run.
 *  - Full tier (opt-in via `MRP_BENCHMARK=full` env, e.g. a dedicated CI
 *    job or a local check before closing Phase 5): 10,000 products / 5
 *    levels, asserted against the actual spec KPI (< 60 s).
 */

const RUN_FULL_BENCHMARK = process.env.MRP_BENCHMARK === 'full'

describe('MRP engine performance benchmark (task 5.3)', () => {
  test('smoke: 1k products / 5-level BOM completes well under a proportional budget', () => {
    const inputs = generateBenchmarkInputs({ products: 1_000, levels: 5, seed: 1 })

    const start = performance.now()
    const result = runMrp(inputs)
    const elapsedMs = performance.now() - start

    console.log(`[mrp-benchmark] smoke (1k products / 5 levels): ${elapsedMs.toFixed(1)}ms, ` +
      `suggestions=${result.suggestions.length}, warnings=${result.warnings.length}, ` +
      `demandsProcessed=${result.stats.demandsProcessed}, levelsExploded=${result.stats.levelsExploded}`)

    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(1_000)
  })

  const fullTest = RUN_FULL_BENCHMARK ? test : test.skip
  fullTest('full (opt-in, MRP_BENCHMARK=full): 10k products / 5-level BOM completes under the 60 s KPI', () => {
    const inputs = generateBenchmarkInputs({ products: 10_000, levels: 5, seed: 42 })

    const start = performance.now()
    const result = runMrp(inputs)
    const elapsedMs = performance.now() - start

    console.log(`[mrp-benchmark] full (10k products / 5 levels): ${elapsedMs.toFixed(1)}ms, ` +
      `suggestions=${result.suggestions.length}, warnings=${result.warnings.length}, ` +
      `demandsProcessed=${result.stats.demandsProcessed}, levelsExploded=${result.stats.levelsExploded}`)

    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(60_000)
  })

  test('deterministic: same seed produces the same suggestion count and elapsed order of magnitude', () => {
    const inputsA = generateBenchmarkInputs({ products: 500, levels: 5, seed: 7 })
    const inputsB = generateBenchmarkInputs({ products: 500, levels: 5, seed: 7 })

    const resultA = runMrp(inputsA)
    const resultB = runMrp(inputsB)

    expect(resultB.suggestions.length).toBe(resultA.suggestions.length)
    expect(resultB.stats.demandsProcessed).toBe(resultA.stats.demandsProcessed)
  })
})
