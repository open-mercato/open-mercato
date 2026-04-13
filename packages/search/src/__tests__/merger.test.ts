import { deduplicateResults, mergeAndRankResults, normalizeScores } from '../lib/merger'
import type { ResultMergeConfig, SearchResult, SearchStrategyId } from '../types'

const DEFAULT_CONFIG: ResultMergeConfig = {
  duplicateHandling: 'highest_score',
}

function createResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    entityId: 'customers:company',
    recordId: 'record-1',
    score: 0.5,
    source: 'tokens',
    ...overrides,
  }
}

function createConfig(overrides: Partial<ResultMergeConfig> = {}): ResultMergeConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  }
}

function rrf(rank: number, weight = 1): number {
  return weight / (60 + rank + 1)
}

describe('merger', () => {
  describe('mergeAndRankResults', () => {
    it('returns an empty array when there are no results', () => {
      expect(mergeAndRankResults([], createConfig())).toEqual([])
    })

    it('combines RRF scores and enriches missing presenter data from another strategy', () => {
      const merged = mergeAndRankResults(
        [
          createResult({
            source: 'tokens',
            score: 0.3,
            metadata: { origin: 'tokens' },
          }),
          createResult({
            source: 'fulltext',
            score: 0.9,
            presenter: { title: 'Acme Corp', badge: 'Company' },
            url: '/backend/customers/record-1',
            links: [{ href: '/backend/customers/record-1/edit', label: 'Edit' }],
          }),
        ],
        createConfig({
          strategyWeights: {
            tokens: 0.8,
            fulltext: 1.2,
          } as Record<SearchStrategyId, number>,
        }),
      )

      expect(merged).toHaveLength(1)
      expect(merged[0]).toMatchObject({
        source: 'tokens',
        presenter: { title: 'Acme Corp', badge: 'Company' },
        url: '/backend/customers/record-1',
        links: [{ href: '/backend/customers/record-1/edit', label: 'Edit' }],
      })
      expect(merged[0].score).toBeCloseTo(rrf(0, 0.8) + rrf(0, 1.2))
      expect(merged[0].metadata).toEqual(
        expect.objectContaining({
          origin: 'tokens',
          _sources: ['tokens', 'fulltext'],
          _rrfScore: expect.any(Number),
        }),
      )
      expect(merged[0].metadata?._rrfScore).toBeCloseTo(rrf(0, 0.8) + rrf(0, 1.2))
    })

    it('prefers the duplicate with the stronger contribution when both results have presenters', () => {
      const merged = mergeAndRankResults(
        [
          createResult({
            source: 'tokens',
            score: 0.95,
            presenter: { title: 'Token Result' },
            url: '/tokens/record-1',
          }),
          createResult({
            source: 'fulltext',
            score: 0.2,
            presenter: { title: 'Fulltext Result' },
            url: '/fulltext/record-1',
          }),
        ],
        createConfig({
          strategyWeights: {
            tokens: 0.8,
            fulltext: 1.2,
          } as Record<SearchStrategyId, number>,
        }),
      )

      expect(merged).toHaveLength(1)
      expect(merged[0]).toMatchObject({
        source: 'fulltext',
        presenter: { title: 'Fulltext Result' },
        url: '/fulltext/record-1',
      })
      expect(merged[0].score).toBeCloseTo(rrf(0, 0.8) + rrf(0, 1.2))
    })

    it('keeps the presented result when a later duplicate lacks presenter data', () => {
      const merged = mergeAndRankResults(
        [
          createResult({
            source: 'fulltext',
            presenter: { title: 'Fulltext Result' },
            url: '/fulltext/record-1',
          }),
          createResult({
            source: 'tokens',
            score: 0.9,
            url: '/tokens/record-1',
          }),
        ],
        createConfig({
          strategyWeights: {
            fulltext: 1.2,
            tokens: 0.8,
          } as Record<SearchStrategyId, number>,
        }),
      )

      expect(merged).toHaveLength(1)
      expect(merged[0]).toMatchObject({
        source: 'fulltext',
        presenter: { title: 'Fulltext Result' },
        url: '/fulltext/record-1',
      })
    })

    it('keeps the duplicate with the stronger contribution when neither result has presenter data', () => {
      const merged = mergeAndRankResults(
        [
          createResult({
            source: 'tokens',
            url: '/tokens/record-1',
          }),
          createResult({
            source: 'fulltext',
            url: '/fulltext/record-1',
          }),
        ],
        createConfig({
          strategyWeights: {
            tokens: 0.8,
            fulltext: 1.2,
          } as Record<SearchStrategyId, number>,
        }),
      )

      expect(merged).toHaveLength(1)
      expect(merged[0]).toMatchObject({
        source: 'fulltext',
        url: '/fulltext/record-1',
      })
    })

    it('filters out results below the configured minimum score threshold', () => {
      const merged = mergeAndRankResults(
        [
          createResult({
            source: 'fulltext',
            recordId: 'record-1',
          }),
          createResult({
            source: 'tokens',
            recordId: 'record-2',
          }),
        ],
        createConfig({
          minScore: 0.015,
          strategyWeights: {
            fulltext: 1.2,
            tokens: 0.8,
          } as Record<SearchStrategyId, number>,
        }),
      )

      expect(merged).toHaveLength(1)
      expect(merged[0]?.recordId).toBe('record-1')
      expect(merged[0]?.score).toBeCloseTo(rrf(0, 1.2))
    })
  })

  describe('deduplicateResults', () => {
    it('keeps the highest-scored duplicate and sorts all remaining results by score', () => {
      const deduplicated = deduplicateResults([
        createResult({
          source: 'tokens',
          recordId: 'record-1',
          score: 0.4,
        }),
        createResult({
          source: 'fulltext',
          recordId: 'record-1',
          score: 0.9,
          presenter: { title: 'Preferred Result' },
        }),
        createResult({
          source: 'vector',
          recordId: 'record-2',
          score: 0.7,
        }),
      ])

      expect(deduplicated).toHaveLength(2)
      expect(deduplicated.map((result) => [result.recordId, result.score])).toEqual([
        ['record-1', 0.9],
        ['record-2', 0.7],
      ])
      expect(deduplicated[0]?.presenter?.title).toBe('Preferred Result')
    })
  })

  describe('normalizeScores', () => {
    it('returns an empty array for empty input', () => {
      expect(normalizeScores([])).toEqual([])
    })

    it('normalizes scores to the 0-1 range', () => {
      const normalized = normalizeScores([
        createResult({ recordId: 'record-1', score: 10 }),
        createResult({ recordId: 'record-2', score: 15 }),
        createResult({ recordId: 'record-3', score: 20 }),
      ])

      expect(normalized.map((result) => [result.recordId, result.score])).toEqual([
        ['record-1', 0],
        ['record-2', 0.5],
        ['record-3', 1],
      ])
    })

    it('normalizes equal scores to 1.0', () => {
      const normalized = normalizeScores([
        createResult({ recordId: 'record-1', score: 7 }),
        createResult({ recordId: 'record-2', score: 7 }),
      ])

      expect(normalized.map((result) => result.score)).toEqual([1, 1])
    })
  })
})
