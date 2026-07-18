import { describe, it, expect } from '@jest/globals'
import { explodeBom, explodeOneLevel, findBomCycle, type BomItemsByProductKey } from '../bomGraph'

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

describe('explodeOneLevel', () => {
  it('stops at the first real component and does NOT recurse into its own subtree', () => {
    // A -> B (x2) -> C (x3): one level down from A must return ONLY B, not C.
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'B', qtyPerUnit: 2, uom: 'pcs' }],
      B: [{ componentKey: 'C', qtyPerUnit: 3, uom: 'pcs' }],
    }

    const result = explodeOneLevel(bom, 'A')

    expect(result).toEqual([{ componentKey: 'B', qtyPerUnit: 2, uom: 'pcs' }])
  })

  it('chases a phantom item through transparently, never listing the phantom itself', () => {
    // A -> P (phantom, x2) -> X (x5): one level down from A must return X
    // (qty 2*5=10), never P.
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'P', qtyPerUnit: 2, uom: 'pcs', isPhantom: true }],
      P: [{ componentKey: 'X', qtyPerUnit: 5, uom: 'kg' }],
    }

    const result = explodeOneLevel(bom, 'A')

    expect(result).toEqual([{ componentKey: 'X', qtyPerUnit: 10, uom: 'kg' }])
  })

  it('compounds scrap factor multiplicatively through a phantom chain', () => {
    // A -> P (phantom, x2, 10% scrap) -> X (x5, 20% scrap)
    // effective = 2*1.1 * 5*1.2 = 2.2 * 6 = 13.2
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'P', qtyPerUnit: 2, uom: 'pcs', isPhantom: true, scrapFactor: 0.1 }],
      P: [{ componentKey: 'X', qtyPerUnit: 5, uom: 'kg', scrapFactor: 0.2 }],
    }

    const result = explodeOneLevel(bom, 'A')

    expect(result).toHaveLength(1)
    expect(result[0].componentKey).toBe('X')
    expect(result[0].qtyPerUnit).toBeCloseTo(13.2, 6)
  })

  it('aggregates a component reached both directly and through a phantom into one entry', () => {
    // A -> X directly (x1) AND A -> P (phantom, x1) -> X (x2): total qtyPerUnit = 1 + 2 = 3.
    const bom: BomItemsByProductKey = {
      A: [
        { componentKey: 'X', qtyPerUnit: 1, uom: 'pcs' },
        { componentKey: 'P', qtyPerUnit: 1, uom: 'pcs', isPhantom: true },
      ],
      P: [{ componentKey: 'X', qtyPerUnit: 2, uom: 'pcs' }],
    }

    const result = explodeOneLevel(bom, 'A')

    expect(result).toEqual([{ componentKey: 'X', qtyPerUnit: 3, uom: 'pcs' }])
  })

  it('throws on a phantom self-cycle, matching explodeBom safety-net behavior', () => {
    // A non-phantom self-reference is a harmless leaf entry (explodeOneLevel
    // never recurses into a REAL component's own subtree by design) -- only
    // a phantom chain recurses, so the cycle guard is exercised via a
    // phantom self-loop.
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'A', qtyPerUnit: 1, uom: 'pcs', isPhantom: true }],
    }

    expect(() => explodeOneLevel(bom, 'A')).toThrow(/cycle/i)
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
