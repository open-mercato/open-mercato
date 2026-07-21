import fs from 'node:fs'
import path from 'node:path'
import type { GalleryEntry } from '../../gallery/types'
import { checkMockupIntegrity, loadGalleryEntryMap } from '../integrity'
import { findRepoRoot } from '../loader'
import { flowOutline, type FlowOutline } from '../flow'
import { generateDraftDocuments } from '../generation'
import { collectLeaves } from '../schema'

/**
 * Phase 3 — flow-outline schema and outline-driven draft generation.
 * The golden pin: the committed flow fixture must regenerate the committed
 * draft fixture EXACTLY (deterministic mapping), the draft must pass the same
 * schema + registry-integrity gate as any committed mockup, and every
 * generated document is draft: true with all blocks proposed — never
 * auto-final.
 */

let entries: Map<string, GalleryEntry>
let entryIds: Set<string>
let repoRoot: string
let goldenOutline: FlowOutline

beforeAll(async () => {
  entries = await loadGalleryEntryMap()
  entryIds = new Set(entries.keys())
  const root = findRepoRoot(__dirname)
  if (!root) throw new Error('repo root not found')
  repoRoot = root
  const flowPath = path.join(repoRoot, '.ai', 'mockups', 'customers-quick-add.flow.json')
  goldenOutline = flowOutline.parse(JSON.parse(fs.readFileSync(flowPath, 'utf8')))
})

function validOutline(): Record<string, unknown> {
  return {
    version: 1,
    source: 'US-TEST-1',
    screens: [
      {
        slug: 'test-screen',
        purpose: 'Test screen',
        order: 1,
        intents: [
          {
            kind: 'list',
            description: 'Browse things',
            userStory: 'US-TEST-1',
            fields: [
              { name: 'name' },
              { name: 'status', type: 'select', options: ['open', 'closed'] },
            ],
          },
        ],
      },
    ],
    transitions: [],
  }
}

describe('design_system flow outline schema', () => {
  it('parses the golden flow fixture', () => {
    expect(goldenOutline.screens).toHaveLength(1)
    expect(goldenOutline.entity).toBe('person')
  })

  it('parses a minimal valid outline', () => {
    expect(flowOutline.safeParse(validOutline()).success).toBe(true)
  })

  it('rejects an unknown intent kind', () => {
    const outline = validOutline()
    ;(outline.screens as Array<{ intents: Array<{ kind: string }> }>)[0].intents[0].kind = 'wizard'
    expect(flowOutline.safeParse(outline).success).toBe(false)
  })

  it('rejects a select field without options', () => {
    const outline = validOutline()
    ;(outline.screens as Array<{ intents: Array<{ fields: unknown[] }> }>)[0].intents[0].fields = [
      { name: 'status', type: 'select' },
    ]
    expect(flowOutline.safeParse(outline).success).toBe(false)
  })

  it('rejects non-camelCase field names', () => {
    const outline = validOutline()
    ;(outline.screens as Array<{ intents: Array<{ fields: unknown[] }> }>)[0].intents[0].fields = [
      { name: 'first_name' },
    ]
    expect(flowOutline.safeParse(outline).success).toBe(false)
  })

  it('rejects a transition from an unknown screen', () => {
    const outline = validOutline()
    outline.transitions = [{ from: 'no-such-screen', to: 'test-screen', trigger: 'save' }]
    expect(flowOutline.safeParse(outline).success).toBe(false)
  })

  it('rejects malformed userStory tags', () => {
    const outline = validOutline()
    ;(outline.screens as Array<{ intents: Array<{ userStory: string }> }>)[0].intents[0].userStory =
      'story 1'
    expect(flowOutline.safeParse(outline).success).toBe(false)
  })
})

describe('design_system outline-driven draft generation', () => {
  it('golden pin: the flow fixture regenerates the committed draft exactly', () => {
    const { documents } = generateDraftDocuments(goldenOutline, entryIds)
    expect(documents).toHaveLength(1)
    const committed = JSON.parse(
      fs.readFileSync(path.join(repoRoot, '.ai', 'mockups', 'customers-quick-add.mockup.json'), 'utf8'),
    )
    expect(JSON.parse(JSON.stringify(documents[0]))).toEqual(committed)
  })

  it('is deterministic: two runs yield identical documents', () => {
    const first = generateDraftDocuments(goldenOutline, entryIds)
    const second = generateDraftDocuments(goldenOutline, entryIds)
    expect(JSON.stringify(first.documents)).toBe(JSON.stringify(second.documents))
  })

  it('always emits draft: true with every block proposed and stories carried', () => {
    const { documents } = generateDraftDocuments(goldenOutline, entryIds)
    for (const document of documents) {
      expect(document.draft).toBe(true)
      for (const leaf of collectLeaves(document.root)) {
        expect(leaf.status).toBe('proposed')
      }
    }
    const leaves = collectLeaves(documents[0].root)
    expect(leaves.some((leaf) => leaf.userStory === 'US-CRM-301')).toBe(true)
  })

  it('generated documents pass the full registry-integrity gate', () => {
    const { documents } = generateDraftDocuments(goldenOutline, entryIds)
    for (const document of documents) {
      expect(checkMockupIntegrity(document, entries)).toEqual([])
    }
  })

  it('maps unmappable intents (navigation/action) to placeholders labeled with the intent', () => {
    const { documents, notes } = generateDraftDocuments(goldenOutline, entryIds)
    const placeholder = collectLeaves(documents[0].root).find((leaf) => leaf.id === 'i3-navigation')
    expect(placeholder).toMatchObject({
      type: 'placeholder',
      label: 'Return to the people list',
      status: 'proposed',
    })
    expect(notes.some((note) => note.includes('i3-navigation'))).toBe(true)
  })

  it('degrades a mapped entry missing from the registry to an honest placeholder', () => {
    const withoutTables = new Set(entryIds)
    withoutTables.delete('form-field')
    const { documents, notes } = generateDraftDocuments(goldenOutline, withoutTables)
    const fallback = collectLeaves(documents[0].root).find(
      (leaf) => leaf.id === 'i1-field-firstName',
    )
    expect(fallback?.type).toBe('placeholder')
    expect(notes.some((note) => note.includes('form-field'))).toBe(true)
  })

  it('list intents produce header + filter bar + table with columns, rows, and an empty state', () => {
    const parsed = flowOutline.parse(validOutline())
    const { documents } = generateDraftDocuments(parsed, entryIds)
    const leaves = collectLeaves(documents[0].root)
    expect(leaves.map((leaf) => (leaf.type === 'block' ? leaf.entry : 'placeholder'))).toEqual([
      'section-header',
      'filter-bar',
      'table',
    ])
    const table = leaves[2]
    if (table.type !== 'block') throw new Error('expected a table block')
    const props = table.props as {
      columns: Array<{ id: string }>
      rows: unknown[]
      emptyState: { title: string }
    }
    expect(props.columns.map((column) => column.id)).toEqual(['name', 'status'])
    expect(props.rows).toHaveLength(3)
    expect(props.emptyState.title).toBeTruthy()
    expect(checkMockupIntegrity(documents[0], entries)).toEqual([])
  })

  it('dashboard intents produce a KPI columns row', () => {
    const outline = flowOutline.parse({
      ...validOutline(),
      screens: [
        {
          slug: 'test-dashboard',
          purpose: 'Test dashboard',
          order: 1,
          intents: [
            {
              kind: 'dashboard',
              description: 'Key numbers',
              fields: [{ name: 'activeCount', type: 'number' }, { name: 'openValue', type: 'number' }],
            },
          ],
        },
      ],
    })
    const { documents } = generateDraftDocuments(outline, entryIds)
    const root = documents[0].root
    if (root.type !== 'stack') throw new Error('expected stack root')
    const kpis = root.children[0]
    if (kpis.type !== 'columns') throw new Error('expected a columns node')
    expect(kpis.weights).toEqual([1, 1])
    expect(
      kpis.children.map((child) => (child.type === 'block' ? child.entry : child.type)),
    ).toEqual(['kpi-card', 'kpi-card'])
    expect(checkMockupIntegrity(documents[0], entries)).toEqual([])
  })
})
