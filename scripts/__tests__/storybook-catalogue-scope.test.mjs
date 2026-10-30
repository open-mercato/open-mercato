import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { readGallery } from '../../packages/create-app/scripts/design-system-sources.mjs'
import { buildFigmaLibrary } from '../storybook-figma-library.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const removedFamilies = ['landing', 'landing-assets', 'hr-management', 'finance-pages', 'crm-pages']

// The Figma page manifest is a read-only export from the source file, produced by whoever runs the
// audit. It is not in the repo, and the counts below are a snapshot of that export, so they cannot be
// reconstructed here — asserting them against an absent manifest just reports `0 !== 90` forever
// (#6223). Gate the snapshot on the manifest being present; the scope assertions above it read
// committed gallery data and always run, which is the part that guards the removed sections.
const figmaManifest = path.join(root, 'docs/design-system/figma-audit/pages.json')
const hasFigmaManifest = fs.existsSync(figmaManifest)

function readCatalogue() {
  const { families, entries } = readGallery(root)
  return { families, entries }
}

test('removed product sections stay out of catalogue navigation', () => {
  const { families, entries } = readCatalogue()
  for (const family of families) assert.ok(!removedFamilies.includes(family.id))
  for (const entry of entries) assert.doesNotMatch(entry.entryId, /^(landing|hr|finance|crm)-/)
  const sidebar = entries.find(entry => entry.entryId === 'sidebar')
  assert.ok(sidebar)
  for (const variant of sidebar.variantIds) assert.doesNotMatch(variant, /^(hr|finance)-/)
})

test('removed product sections stay out of source-library search', { skip: hasFigmaManifest ? false : `missing ${path.relative(root, figmaManifest)} (#6223)` }, () => {
  const { entries } = readCatalogue()
  const catalogue = entries.map(entry => ({ id: entry.entryId, family: entry.familyId, title: entry.title, variantCount: entry.variantIds.length }))
  const library = buildFigmaLibrary(root, catalogue)
  assert.equal(library.manifestPageCount, 90)
  assert.equal(library.sectionPageCount, 6)
  assert.equal(library.excludedPageCount, 24)
  assert.equal(library.pages.length, 60)
  assert.equal(library.pages.length + library.excludedPageCount + library.sectionPageCount, library.manifestPageCount)
  assert.ok(library.pages.some(page => page.id === '553:14956'))
  assert.ok(library.pages.some(page => page.id === '6696:81119'))
  for (const page of library.pages) {
    assert.notEqual(page.group, 'Landing Page')
    assert.ok(!['3715:42038', '3911:35677', '199833:76012', '2950:5881'].includes(page.id))
    for (const story of page.stories) assert.ok(!removedFamilies.includes(story.family))
  }
})
