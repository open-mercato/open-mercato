import type { DecisionAnswer } from '@open-mercato/shared/lib/ai/decision-model'
import { walkCategoryTree, type TreeWalkCategory, type TreeWalkInput } from '../treeWalk'
import type { CatalogDecisionModelPort, CatalogDecisionModelDecideResult } from '../decisionModelPort'
import type { CatalogProductState } from '../productState'

const PRODUCT_STATE: CatalogProductState = {
  title: 'Widget',
  subtitle: null,
  description: null,
  sku: null,
  productType: 'simple',
  tags: [],
  options: [],
  custom: {},
}

function category(id: string, name: string, pathLabel?: string): TreeWalkCategory {
  return { id, name, pathLabel: pathLabel ?? name }
}

function choiceAnswer(value: string, probabilities: Array<{ key: string; probability: number }>): DecisionAnswer {
  return { type: 'choice', value, probabilities, confidence: null }
}

function ok(answers: Record<string, DecisionAnswer>): CatalogDecisionModelDecideResult {
  return {
    ok: true,
    result: { answers, provider: 'stub', model: 'stub', usage: { inputTokens: null, outputTokens: null, costUsd: null }, durationMs: 1 },
  }
}

function fail(code: string): CatalogDecisionModelDecideResult {
  return { ok: false, error: { code, message: code } }
}

function buildInput(overrides: Partial<TreeWalkInput> & { decide: jest.Mock }): TreeWalkInput {
  const port: CatalogDecisionModelPort = {
    getAvailability: () => ({ available: true }),
    decide: overrides.decide,
  }
  return {
    port,
    productId: 'product-1',
    productState: PRODUCT_STATE,
    roots: overrides.roots ?? [],
    childrenOf: overrides.childrenOf ?? (() => []),
    ...overrides,
  }
}

describe('walkCategoryTree', () => {
  it('returns no_match without calling the port when there are no root categories', async () => {
    const decide = jest.fn()
    const result = await walkCategoryTree(buildInput({ decide, roots: [] }))
    expect(result).toEqual({ outcome: 'no_match' })
    expect(decide).not.toHaveBeenCalled()
  })

  it('returns no_match when the root pick is the __none sentinel', async () => {
    const decide = jest.fn().mockResolvedValue(
      ok({ level: choiceAnswer('__none', [
        { key: 'a', probability: 0.1 },
        { key: '__none', probability: 0.9 },
      ]) }),
    )
    const result = await walkCategoryTree(buildInput({ decide, roots: [category('a', 'A')] }))
    expect(result).toEqual({ outcome: 'no_match' })
  })

  it('returns no_match when the root pick has low confidence', async () => {
    const decide = jest.fn().mockResolvedValue(
      ok({ level: choiceAnswer('a', [
        { key: 'a', probability: 0.2 },
        { key: '__none', probability: 0.8 },
      ]) }),
    )
    const result = await walkCategoryTree(buildInput({ decide, roots: [category('a', 'A')] }))
    expect(result).toEqual({ outcome: 'no_match' })
  })

  it('stops early on a __here pick below root, suggesting the parent with unchanged confidence', async () => {
    const tree: Record<string, TreeWalkCategory[]> = {
      root: [category('a', 'A')],
      a: [category('b', 'B')],
      b: [category('c', 'C')],
    }
    const decide = jest.fn()
      .mockResolvedValueOnce(ok({ level: choiceAnswer('a', [{ key: 'a', probability: 0.9 }, { key: '__none', probability: 0.1 }]) }))
      .mockResolvedValueOnce(ok({ level: choiceAnswer('b', [{ key: 'b', probability: 0.8 }, { key: '__here', probability: 0.2 }]) }))
      .mockResolvedValueOnce(ok({ level: choiceAnswer('__here', [{ key: 'c', probability: 0.1 }, { key: '__here', probability: 0.9 }]) }))

    const result = await walkCategoryTree(buildInput({
      decide,
      roots: tree.root,
      childrenOf: (id) => tree[id] ?? [],
    }))

    expect(result).toEqual({
      outcome: 'suggested',
      categoryId: 'b',
      categoryPathIds: ['a', 'b'],
      confidence: 0.9 * 0.8,
      levels: [
        { categoryId: 'a', probability: 0.9, alternatives: [] },
        { categoryId: 'b', probability: 0.8, alternatives: [] },
      ],
    })
    expect(decide).toHaveBeenCalledTimes(3)
  })

  it('walks a deep path and stops at MAX_DEPTH even when the leaf still has children', async () => {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const tree: Record<string, TreeWalkCategory[]> = { root: [category('a', 'A')] }
    for (let i = 0; i < letters.length - 1; i += 1) {
      tree[letters[i]] = [category(letters[i + 1], letters[i + 1].toUpperCase())]
    }
    const decide = jest.fn().mockImplementation(async (input: { request: { questions: Record<string, any> } }) => {
      const options = input.request.questions.level.options as Array<{ key: string }>
      const realOption = options.find((option: { key: string }) => !option.key.startsWith('__'))!
      return ok({ level: choiceAnswer(realOption.key, options.map((option: { key: string }) => ({
        key: option.key,
        probability: option.key === realOption.key ? 0.9 : 0.1 / (options.length - 1),
      }))) })
    })

    const result = await walkCategoryTree(buildInput({
      decide,
      roots: tree.root,
      childrenOf: (id) => tree[id] ?? [],
    }))

    expect(result.outcome).toBe('suggested')
    if (result.outcome === 'suggested') {
      expect(result.categoryPathIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
      expect(result.categoryPathIds.length).toBe(6)
    }
    expect(decide).toHaveBeenCalledTimes(6)
  })

  it('stops at a leaf with no children before reaching MAX_DEPTH', async () => {
    const tree: Record<string, TreeWalkCategory[]> = { root: [category('a', 'A')], a: [] }
    const decide = jest.fn().mockResolvedValue(
      ok({ level: choiceAnswer('a', [{ key: 'a', probability: 1 }, { key: '__none', probability: 0 }]) }),
    )
    const result = await walkCategoryTree(buildInput({ decide, roots: tree.root, childrenOf: (id) => tree[id] ?? [] }))
    expect(result).toEqual({
      outcome: 'suggested',
      categoryId: 'a',
      categoryPathIds: ['a'],
      confidence: 1,
      levels: [{ categoryId: 'a', probability: 1, alternatives: [] }],
    })
  })

  it('splits a 127-child level into 43/42/42 chunks plus a final question, in one batched request', async () => {
    const categories = Array.from({ length: 127 }, (_, i) => category(`c${String(i).padStart(3, '0')}`, `Cat ${String(i).padStart(3, '0')}`))
    const decide = jest.fn().mockImplementation(async (input: { request: { questions: Record<string, any> } }) => {
      const questionNames = Object.keys(input.request.questions)
      if (questionNames.includes('chunk_0')) {
        expect(input.request.questions.chunk_0.options.length).toBe(43)
        expect(input.request.questions.chunk_1.options.length).toBe(42)
        expect(input.request.questions.chunk_2.options.length).toBe(42)
        // No sentinel in chunk questions.
        for (const name of questionNames) {
          expect(input.request.questions[name].options.some((o: { key: string }) => o.key.startsWith('__'))).toBe(false)
        }
        return ok({
          chunk_0: choiceAnswer('c000', [{ key: 'c000', probability: 0.5 }, ...Array.from({ length: 42 }, (_, i) => ({ key: categories[i + 1].id, probability: 0.5 / 42 }))]),
          chunk_1: choiceAnswer('c043', [{ key: 'c043', probability: 0.6 }, ...Array.from({ length: 41 }, (_, i) => ({ key: categories[44 + i].id, probability: 0.4 / 41 }))]),
          chunk_2: choiceAnswer('c085', [{ key: 'c085', probability: 0.7 }, ...Array.from({ length: 41 }, (_, i) => ({ key: categories[86 + i].id, probability: 0.3 / 41 }))]),
        })
      }
      // Final question: 3 chunk winners + sentinel.
      expect(questionNames).toEqual(['final'])
      expect(input.request.questions.final.options.length).toBe(4)
      return ok({ final: choiceAnswer('c000', [
        { key: 'c000', probability: 0.8 },
        { key: 'c043', probability: 0.15 },
        { key: 'c085', probability: 0.04 },
        { key: '__none', probability: 0.01 },
      ]) })
    })

    const result = await walkCategoryTree(buildInput({ decide, roots: categories, childrenOf: () => [] }))
    expect(decide).toHaveBeenCalledTimes(2)
    expect(result.outcome).toBe('suggested')
    if (result.outcome === 'suggested') {
      expect(result.categoryId).toBe('c000')
      expect(result.confidence).toBeCloseTo(0.5 * 0.8, 10)
      expect(result.levels[0].alternatives.map((a) => a.categoryId)).toEqual(['c043', 'c085'])
    }
  })

  it('returns no_match with reason level_too_wide for more than 504 children, without calling the port', async () => {
    const categories = Array.from({ length: 505 }, (_, i) => category(`c${i}`, `Cat ${i}`))
    const decide = jest.fn()
    const result = await walkCategoryTree(buildInput({ decide, roots: categories, childrenOf: () => [] }))
    expect(result).toEqual({ outcome: 'no_match', reason: 'level_too_wide' })
    expect(decide).not.toHaveBeenCalled()
  })

  it('treats the sentinel winning the final tournament question as a sentinel pick', async () => {
    const categories = Array.from({ length: 64 }, (_, i) => category(`c${String(i).padStart(2, '0')}`, `Cat ${i}`))
    const decide = jest.fn().mockImplementation(async (input: { request: { questions: Record<string, any> } }) => {
      const questionNames = Object.keys(input.request.questions)
      if (questionNames.includes('chunk_0')) {
        return ok({
          chunk_0: choiceAnswer(categories[0].id, [{ key: categories[0].id, probability: 0.9 }, ...categories.slice(1, 32).map((c) => ({ key: c.id, probability: 0.1 / 31 }))]),
          chunk_1: choiceAnswer(categories[32].id, [{ key: categories[32].id, probability: 0.8 }, ...categories.slice(33).map((c) => ({ key: c.id, probability: 0.2 / 31 }))]),
        })
      }
      return ok({ final: choiceAnswer('__none', [
        { key: categories[0].id, probability: 0.3 },
        { key: categories[32].id, probability: 0.2 },
        { key: '__none', probability: 0.5 },
      ]) })
    })
    const result = await walkCategoryTree(buildInput({ decide, roots: categories, childrenOf: () => [] }))
    expect(result).toEqual({ outcome: 'no_match' })
  })

  const errorCodes = ['unavailable', 'invalid_request', 'auth', 'insufficient_credits', 'rate_limited', 'payload_too_large', 'timeout', 'aborted', 'provider_error', 'invalid_response', 'some_future_code']
  it.each(errorCodes)('maps port error code %s to an error outcome (aborted -> timeout)', async (code) => {
    const decide = jest.fn().mockResolvedValue(fail(code))
    const result = await walkCategoryTree(buildInput({ decide, roots: [category('a', 'A')] }))
    expect(result).toEqual({ outcome: 'error', code: code === 'aborted' ? 'timeout' : code })
  })

  it('returns a timeout error when the inline budget is exhausted before the next call', async () => {
    let elapsed = 0
    const decide = jest.fn().mockResolvedValue(
      ok({ level: choiceAnswer('a', [{ key: 'a', probability: 1 }, { key: '__none', probability: 0 }]) }),
    )
    const result = await walkCategoryTree(buildInput({
      decide,
      roots: [category('a', 'A')],
      budgetMs: 10,
      now: () => {
        elapsed += 20
        return elapsed
      },
    }))
    expect(result).toEqual({ outcome: 'error', code: 'timeout' })
    expect(decide).not.toHaveBeenCalled()
  })
})
