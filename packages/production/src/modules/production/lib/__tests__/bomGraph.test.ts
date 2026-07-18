import { describe, it, expect } from '@jest/globals'
import { explodeBom, findBomCycle, type BomItemsByProductKey } from '../bomGraph'

describe('explodeBom', () => {
  it('explodes a multi-level BOM (3+ levels) rolling up quantities correctly', () => {
    // A (root) -> B (x2) -> C (x3) -> D (x4), no scrap.
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'B', qtyPerUnit: 2 }],
      B: [{ componentKey: 'C', qtyPerUnit: 3 }],
      C: [{ componentKey: 'D', qtyPerUnit: 4 }],
    }

    const result = explodeBom(bom, 'A', 10)
    const byKey = Object.fromEntries(result.map((r) => [r.componentKey, r.qty]))

    expect(byKey.B).toBe(20)
    expect(byKey.C).toBe(60)
    expect(byKey.D).toBe(240)
  })

  it('passes phantom items through without listing the phantom itself', () => {
    // A -> P (phantom, x1) -> X (x5). Result must contain X, not P.
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'P', qtyPerUnit: 1, isPhantom: true }],
      P: [{ componentKey: 'X', qtyPerUnit: 5 }],
    }

    const result = explodeBom(bom, 'A', 2)
    const byKey = Object.fromEntries(result.map((r) => [r.componentKey, r.qty]))

    expect(byKey.P).toBeUndefined()
    expect(byKey.X).toBe(10)
  })

  it('compounds scrap factor multiplicatively across levels', () => {
    // A -> B (x2, 5% scrap) -> C (x3, 10% scrap)
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'B', qtyPerUnit: 2, scrapFactor: 0.05 }],
      B: [{ componentKey: 'C', qtyPerUnit: 3, scrapFactor: 0.1 }],
    }

    const result = explodeBom(bom, 'A', 1)
    const byKey = Object.fromEntries(result.map((r) => [r.componentKey, r.qtyPerRootUnit]))

    // B: 2 * 1.05 = 2.1
    expect(byKey.B).toBeCloseTo(2.1, 6)
    // C: (3 * 1.1) * 2.1 = 3.3 * 2.1 = 6.93
    expect(byKey.C).toBeCloseTo(6.93, 6)
  })

  it('memoizes shared subtrees instead of recomputing them', () => {
    // A uses X twice: directly, and via B which also uses X's subtree (shared Y).
    // Track how many times each product's item list is READ (not how many times
    // items appear in the result) to prove the shared X/Y subtree is computed once.
    const reads: Record<string, number> = {}
    const raw: BomItemsByProductKey = {
      A: [
        { componentKey: 'X', qtyPerUnit: 1 },
        { componentKey: 'B', qtyPerUnit: 1 },
      ],
      B: [{ componentKey: 'X', qtyPerUnit: 2 }],
      X: [{ componentKey: 'Y', qtyPerUnit: 1 }],
      Y: [],
    }

    const countingBom = new Proxy(raw, {
      get(target, prop: string) {
        reads[prop] = (reads[prop] ?? 0) + 1
        return target[prop as keyof typeof target]
      },
    })

    const result = explodeBom(countingBom, 'A', 1)
    const byKey = Object.fromEntries(result.map((r) => [r.componentKey, r.qty]))

    expect(byKey.X).toBe(3) // 1 (direct) + 2 (via B)
    expect(byKey.Y).toBe(3)
    // X's own item list (and therefore Y's subtree) must be read exactly once,
    // even though X is referenced from two different parents (A and B).
    expect(reads.X).toBe(1)
    expect(reads.Y).toBe(1)
  })

  it('throws when a cycle is encountered during explosion', () => {
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'B', qtyPerUnit: 1 }],
      B: [{ componentKey: 'A', qtyPerUnit: 1 }],
    }

    expect(() => explodeBom(bom, 'A', 1)).toThrow(/cycle/i)
  })
})

describe('findBomCycle', () => {
  it('detects a direct self-cycle (A -> A)', () => {
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'A', qtyPerUnit: 1 }],
    }

    expect(findBomCycle(bom, 'A')).toEqual(['A', 'A'])
  })

  it('detects a transitive cycle (A -> B -> C -> A)', () => {
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'B', qtyPerUnit: 1 }],
      B: [{ componentKey: 'C', qtyPerUnit: 1 }],
      C: [{ componentKey: 'A', qtyPerUnit: 1 }],
    }

    expect(findBomCycle(bom, 'A')).toEqual(['A', 'B', 'C', 'A'])
  })

  it('returns null when there is no cycle', () => {
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'B', qtyPerUnit: 1 }],
      B: [{ componentKey: 'C', qtyPerUnit: 1 }],
      C: [],
    }

    expect(findBomCycle(bom, 'A')).toBeNull()
  })
})
