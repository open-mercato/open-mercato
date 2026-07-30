import { mockupDocument, collectLeaves, type MockupDocument } from '../schema'
import {
  insertLeaf,
  listContainers,
  moveNode,
  removeNode,
  reorderNode,
  uniqueNodeId,
  updateAnnotation,
  updateBlock,
  updatePlaceholderLabel,
} from '../mutations'

/**
 * Studio document mutations (Phase 2): every operation must return a document
 * that still satisfies the zod schema — the studio can never produce an
 * invalid tree.
 */

function fixture(): MockupDocument {
  return mockupDocument.parse({
    version: 1,
    slug: 'mutation-fixture',
    title: 'Mutation fixture',
    root: {
      type: 'stack',
      id: 'root',
      gap: 4,
      children: [
        { type: 'block', id: 'b-header', entry: 'section-header', props: { title: 'X' }, status: 'implemented' },
        {
          type: 'columns',
          id: 'c-kpis',
          weights: [1, 1],
          children: [
            { type: 'block', id: 'b-kpi', entry: 'kpi-card', props: { title: 'A', value: 1 }, status: 'proposed' },
            { type: 'placeholder', id: 'p-panel', label: 'Panel', status: 'proposed' },
          ],
        },
        { type: 'block', id: 'b-table', entry: 'table', variant: 'default', status: 'om-default' },
      ],
    },
  })
}

function expectValid(document: MockupDocument): void {
  const parsed = mockupDocument.safeParse(document)
  expect(parsed.success).toBe(true)
}

describe('design_system mockup studio mutations', () => {
  it('inserts a block into a container at the given index (schema-valid, proposed by default)', () => {
    const doc = fixture()
    const result = insertLeaf(doc, 'root', 1, { type: 'block', entry: 'table', variant: 'default' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectValid(result.document)
    const root = result.document.root as Extract<MockupDocument['root'], { children: unknown[] }>
    expect((root.children[1] as { entry: string }).entry).toBe('table')
    expect((root.children[1] as { status: string }).status).toBe('proposed')
    // Id deduplicated against the existing tree.
    expect((root.children[1] as { id: string }).id).toBe('table')
    // Original untouched (immutability).
    expect(collectLeaves(doc.root)).toHaveLength(4)
  })

  it('generates unique node ids for repeated inserts', () => {
    const doc = fixture()
    const first = insertLeaf(doc, 'root', 0, { type: 'block', entry: 'table' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = insertLeaf(first.document, 'root', 0, { type: 'block', entry: 'table' })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expectValid(second.document)
    expect(uniqueNodeId(second.document, 'table')).toBe('table-3')
  })

  it('inserts a placeholder with a label', () => {
    const result = insertLeaf(fixture(), 'c-kpis', 99, { type: 'placeholder', label: 'Side panel' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectValid(result.document)
  })

  it('refuses inserts into non-containers and unknown parents', () => {
    expect(insertLeaf(fixture(), 'b-header', 0, { type: 'placeholder', label: 'X' }).ok).toBe(false)
    expect(insertLeaf(fixture(), 'nope', 0, { type: 'placeholder', label: 'X' }).ok).toBe(false)
  })

  it('removes a leaf and refuses removing the root', () => {
    const result = removeNode(fixture(), 'b-kpi')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectValid(result.document)
    expect(collectLeaves(result.document.root).map((leaf) => leaf.id)).not.toContain('b-kpi')
    expect(removeNode(fixture(), 'root').ok).toBe(false)
  })

  it('reorders within the parent and stops at the edges', () => {
    const result = reorderNode(fixture(), 'b-header', 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectValid(result.document)
    const root = result.document.root as Extract<MockupDocument['root'], { children: unknown[] }>
    expect((root.children[1] as { id: string }).id).toBe('b-header')
    expect(reorderNode(fixture(), 'b-header', -1).ok).toBe(false)
    expect(reorderNode(fixture(), 'b-table', 1).ok).toBe(false)
  })

  it('moves a node across containers', () => {
    const result = moveNode(fixture(), 'b-table', 'c-kpis', 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectValid(result.document)
    const columns = listContainers(result.document).find((container) => container.id === 'c-kpis')
    expect(columns?.childCount).toBe(3)
  })

  it('refuses moving a container into its own subtree', () => {
    const doc = mockupDocument.parse({
      version: 1,
      slug: 'nested-fixture',
      title: 'Nested fixture',
      root: {
        type: 'stack',
        id: 'root',
        children: [
          {
            type: 'stack',
            id: 's-outer',
            children: [{ type: 'stack', id: 's-inner', children: [] }],
          },
        ],
      },
    })
    expect(moveNode(doc, 's-outer', 's-inner', 0).ok).toBe(false)
  })

  it('swaps entry (clearing variant and props), variant, and props', () => {
    const doc = fixture()
    const swapped = updateBlock(doc, 'b-table', { entry: 'kpi-card' })
    expect(swapped.ok).toBe(true)
    if (!swapped.ok) return
    expectValid(swapped.document)
    const leaf = collectLeaves(swapped.document.root).find((node) => node.id === 'b-table')
    expect(leaf).toMatchObject({ entry: 'kpi-card' })
    expect((leaf as { variant?: string }).variant).toBeUndefined()

    const withProps = updateBlock(swapped.document, 'b-table', { props: { title: 'B', value: 2 } })
    expect(withProps.ok).toBe(true)
    if (!withProps.ok) return
    expectValid(withProps.document)

    const cleared = updateBlock(withProps.document, 'b-table', { props: null })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expectValid(cleared.document)
    const clearedLeaf = collectLeaves(cleared.document.root).find((node) => node.id === 'b-table')
    expect((clearedLeaf as { props?: unknown }).props).toBeUndefined()
  })

  it('flips annotations and clears optional fields with null', () => {
    const doc = fixture()
    const result = updateAnnotation(doc, 'b-kpi', { status: 'implemented', userStory: 'US-7', note: 'shipped' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectValid(result.document)
    const leaf = collectLeaves(result.document.root).find((node) => node.id === 'b-kpi')
    expect(leaf).toMatchObject({ status: 'implemented', userStory: 'US-7', note: 'shipped' })

    const cleared = updateAnnotation(result.document, 'b-kpi', { userStory: null, note: null })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expectValid(cleared.document)
    const clearedLeaf = collectLeaves(cleared.document.root).find((node) => node.id === 'b-kpi')
    expect((clearedLeaf as { userStory?: string }).userStory).toBeUndefined()
    expect((clearedLeaf as { note?: string }).note).toBeUndefined()
  })

  it('edits placeholder labels', () => {
    const result = updatePlaceholderLabel(fixture(), 'p-panel', 'Enrichment panel')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectValid(result.document)
    expect(updatePlaceholderLabel(fixture(), 'b-header', 'X').ok).toBe(false)
  })

  it('reports unknown node ids as errors', () => {
    expect(reorderNode(fixture(), 'ghost', 1).ok).toBe(false)
    expect(removeNode(fixture(), 'ghost').ok).toBe(false)
    expect(updateBlock(fixture(), 'ghost', { entry: 'table' }).ok).toBe(false)
    expect(updateAnnotation(fixture(), 'ghost', { status: 'proposed' }).ok).toBe(false)
  })
})
