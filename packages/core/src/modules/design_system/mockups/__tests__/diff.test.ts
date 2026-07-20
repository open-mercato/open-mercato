import fs from 'node:fs'
import path from 'node:path'
import { computeMockupDiff, diffToneByBlock } from '../diff'
import { findRepoRoot, getMockupBySlug } from '../loader'
import { loadSnapshot } from '../snapshots'
import { mockupDocument, type MockupDocument } from '../schema'

/**
 * Diff delta correctness (Phase 2): block-level delta by id, computed against
 * hand-built fixtures AND the committed golden snapshot pair (@v1 vs @v2 with
 * known deltas).
 */

function doc(children: unknown[]): MockupDocument {
  return mockupDocument.parse({
    version: 1,
    slug: 'diff-fixture',
    title: 'Diff fixture',
    root: { type: 'stack', id: 'root', children },
  })
}

const A = { type: 'block', id: 'a', entry: 'table', variant: 'default', status: 'implemented' }
const B = { type: 'block', id: 'b', entry: 'section-header', props: { title: 'B' }, status: 'proposed' }
const C = { type: 'placeholder', id: 'c', label: 'Panel', status: 'proposed' }

describe('design_system mockup diff', () => {
  it('classifies added, removed, changed, and moved-only blocks', () => {
    const from = doc([A, B, C])
    const to = doc([
      { ...B, props: { title: 'B2' } }, // changed (props) AND moved (index 1 → 0) → changed with position
      A, // moved-only (0 → 1)
      { type: 'block', id: 'd', entry: 'table', status: 'proposed' }, // added
      // c removed
    ])
    const diff = computeMockupDiff(from, to, { slug: 'diff-fixture', from: 'v1', to: 'current' })
    expect(diff.added).toEqual(['d'])
    expect(diff.removed).toEqual(['c'])
    expect(diff.changed).toEqual([{ id: 'b', fields: ['props', 'position'] }])
    expect(diff.moved).toEqual(['a'])
  })

  it('reports annotation-only changes as changed with the field names', () => {
    const from = doc([A])
    const to = doc([{ ...A, status: 'proposed', note: 'flipped' }])
    const diff = computeMockupDiff(from, to, { slug: 'diff-fixture', from: 'v1', to: 'v2' })
    expect(diff.changed).toEqual([{ id: 'a', fields: ['status', 'note'] }])
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.moved).toEqual([])
  })

  it('treats findings as critique metadata, not content — no delta', () => {
    const from = doc([A])
    const to = doc([
      {
        ...A,
        findings: [
          {
            id: 'f1',
            heuristicId: 'nielsen-01',
            severity: 'low',
            summary: 'x',
            atHash: 'h',
          },
        ],
      },
    ])
    const diff = computeMockupDiff(from, to, { slug: 'diff-fixture', from: 'v1', to: 'v2' })
    expect(diff.changed).toEqual([])
    expect(diff.moved).toEqual([])
  })

  it('an identical document yields an empty delta', () => {
    const diff = computeMockupDiff(doc([A, B]), doc([A, B]), { slug: 'diff-fixture', from: 'x', to: 'y' })
    expect(diff).toMatchObject({ added: [], removed: [], changed: [], moved: [] })
  })

  it('diffToneByBlock gives changed precedence over moved and keeps removed', () => {
    const from = doc([A, B, C])
    const to = doc([{ ...B, props: { title: 'B2' } }, A, { type: 'block', id: 'd', entry: 'table', status: 'proposed' }])
    const tones = diffToneByBlock(computeMockupDiff(from, to, { slug: 's', from: 'x', to: 'y' }))
    expect(tones).toEqual({ a: 'moved', b: 'changed', c: 'removed', d: 'added' })
  })
})

describe('design_system golden snapshot pair (@v1 vs @v2)', () => {
  const repoRoot = findRepoRoot(__dirname)

  it('committed snapshots exist and are schema-valid', () => {
    expect(repoRoot).not.toBeNull()
    for (const label of ['v1', 'v2']) {
      const snapshot = loadSnapshot('customers-people-list', label, repoRoot)
      expect(snapshot).not.toBeNull()
      expect(snapshot!.issues).toBeNull()
    }
  })

  it('@v1 → current produces the documented delta (one of each category)', () => {
    const from = loadSnapshot('customers-people-list', 'v1', repoRoot)!.document!
    const to = getMockupBySlug('customers-people-list', repoRoot)!.document!
    const diff = computeMockupDiff(from, to, { slug: 'customers-people-list', from: 'v1', to: 'current' })
    expect(diff.added).toEqual(['view-switcher'])
    expect(diff.removed).toEqual(['export-banner'])
    expect(diff.changed).toEqual([{ id: 'kpi-new-this-week', fields: ['props'] }])
    expect(diff.moved).toEqual(['people-table'])
  })

  it('@v2 matches the current golden document byte-for-byte', () => {
    expect(repoRoot).not.toBeNull()
    const current = getMockupBySlug('customers-people-list', repoRoot)!
    const v2Path = path.join(repoRoot!, '.ai', 'mockups', 'versions', 'customers-people-list@v2.mockup.json')
    expect(fs.readFileSync(v2Path, 'utf8')).toBe(fs.readFileSync(current.filePath, 'utf8'))
  })
})
