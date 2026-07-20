import type { GalleryEntry } from '../../gallery/types'
import { checkMockupIntegrity, loadGalleryEntryMap } from '../integrity'
import { findRepoRoot, loadMockupFile, loadMockups, type LoadedMockup } from '../loader'
import { discoverSnapshotFiles, type MockupSnapshotRef } from '../snapshots'
import { mockupDocument } from '../schema'

/**
 * The CI gate: every committed `*.mockup.json` must validate against the
 * schema, and every block must resolve against the gallery registry —
 * unknown entry/variant references or illegal props fail the build naming
 * the offending file and block.
 */

let entries: Map<string, GalleryEntry>
let mockups: LoadedMockup[]
let snapshots: MockupSnapshotRef[]

beforeAll(async () => {
  entries = await loadGalleryEntryMap()
  const repoRoot = findRepoRoot(__dirname)
  mockups = loadMockups(repoRoot)
  snapshots = discoverSnapshotFiles(repoRoot)
})

describe('design_system mockup registry integrity', () => {
  it('discovers at least the golden mockup', () => {
    expect(mockups.map((mockup) => mockup.slug)).toContain('customers-people-list')
  })

  it('keeps slugs unique across sources', () => {
    const slugs = mockups.map((mockup) => mockup.slug)
    const duplicates = slugs.filter((slug, index) => slugs.indexOf(slug) !== index)
    expect(duplicates).toEqual([])
  })

  it('every committed mockup document validates against the schema', () => {
    const failures = mockups
      .filter((mockup) => mockup.issues !== null)
      .map((mockup) => ({ file: mockup.filePath, issues: mockup.issues }))
    expect(failures).toEqual([])
  })

  it('every block resolves its entry, variant, and props against the gallery registry', () => {
    const failures: Array<{ file: string; blockId: string; message: string }> = []
    for (const mockup of mockups) {
      if (!mockup.document) continue
      for (const issue of checkMockupIntegrity(mockup.document, entries)) {
        failures.push({ file: mockup.filePath, blockId: issue.blockId, message: issue.message })
      }
    }
    expect(failures).toEqual([])
  })

  it('every committed snapshot is schema-valid, registry-true, and matches its filename slug', () => {
    // Snapshots (Phase 2) are ordinary documents under the same CI gate.
    const failures: Array<{ file: string; message: string }> = []
    for (const ref of snapshots) {
      const snapshot = loadMockupFile(ref.filePath, 'ai')
      if (snapshot.issues) {
        for (const issue of snapshot.issues) {
          failures.push({ file: ref.filePath, message: `${issue.path}: ${issue.message}` })
        }
        continue
      }
      if (snapshot.document!.slug !== ref.slug) {
        failures.push({
          file: ref.filePath,
          message: `document slug "${snapshot.document!.slug}" does not match filename slug "${ref.slug}"`,
        })
      }
      for (const issue of checkMockupIntegrity(snapshot.document!, entries)) {
        failures.push({ file: ref.filePath, message: issue.message })
      }
    }
    expect(failures).toEqual([])
  })

  it('fails a document referencing an unknown entry, naming the block', () => {
    const broken = mockupDocument.parse({
      version: 1,
      slug: 'broken-fixture',
      title: 'Deliberately broken fixture',
      root: {
        type: 'stack',
        id: 'root',
        children: [
          { type: 'block', id: 'b-ghost', entry: 'no-such-entry', status: 'implemented' },
        ],
      },
    })
    const issues = checkMockupIntegrity(broken, entries)
    expect(issues).toHaveLength(1)
    expect(issues[0].blockId).toBe('b-ghost')
    expect(issues[0].message).toContain('no-such-entry')
  })

  it('fails a document referencing an unknown variant', () => {
    const broken = mockupDocument.parse({
      version: 1,
      slug: 'broken-variant',
      title: 'Broken variant fixture',
      root: { type: 'block', id: 'b-table', entry: 'table', variant: 'no-such-variant', status: 'implemented' },
    })
    const issues = checkMockupIntegrity(broken, entries)
    expect(issues).toHaveLength(1)
    expect(issues[0].blockId).toBe('b-table')
    expect(issues[0].message).toContain('no-such-variant')
  })

  it('fails props on an entry without compose (silent prop-dropping would lie)', () => {
    const broken = mockupDocument.parse({
      version: 1,
      slug: 'broken-props',
      title: 'Broken props fixture',
      // `table` exposes no compose() — supplying props must fail integrity.
      root: { type: 'block', id: 'b-table', entry: 'table', props: { rows: 3 }, status: 'implemented' },
    })
    const issues = checkMockupIntegrity(broken, entries)
    expect(issues).toHaveLength(1)
    expect(issues[0].blockId).toBe('b-table')
    expect(issues[0].message).toContain('compose')
  })

  it('validates props against composePropsSchema when the entry has one', () => {
    const broken = mockupDocument.parse({
      version: 1,
      slug: 'broken-compose-props',
      title: 'Broken compose props fixture',
      root: {
        type: 'block',
        id: 'b-kpi',
        entry: 'kpi-card',
        props: { title: 'X', value: 'not-a-number' },
        status: 'implemented',
      },
    })
    const issues = checkMockupIntegrity(broken, entries)
    expect(issues).toHaveLength(1)
    expect(issues[0].blockId).toBe('b-kpi')
    expect(issues[0].message).toContain('composePropsSchema')
  })
})
