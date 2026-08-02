import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyStarterPreset, resolvePreset } from './apply-starter-preset.js'
import { VALID_PRESET_IDS } from './starter-presets.js'

const CREATE_APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const WORKSPACE_ROOT = path.resolve(CREATE_APP_ROOT, '../..')
const TEMPLATE_ROOT = path.join(CREATE_APP_ROOT, 'template')
const REFERENCE_ROOT = path.join(TEMPLATE_ROOT, 'src/modules/reference_module')
const INVENTORY_PATH = path.join(REFERENCE_ROOT, 'references/surface-inventory.json')
const MAP_PATH = path.join(REFERENCE_ROOT, 'references/surface-map.md')
const README_PATH = path.join(REFERENCE_ROOT, 'README.md')
const SPEC_PATH = path.join(WORKSPACE_ROOT, '.ai/specs/2026-07-31-standalone-canonical-example-module.md')

type InventoryEntry = {
  capabilityId: string
  owner: string
  coverageKind: 'reference' | 'authoritative-source' | 'specialist-route'
  rollout: 'implemented' | 'planned' | 'routed'
  paths: string[]
}

function loadInventory(): InventoryEntry[] {
  return JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8')) as InventoryEntry[]
}

function frozenCapabilityIds(): string[] {
  const spec = fs.readFileSync(SPEC_PATH, 'utf8')
  const match = spec.match(/The initial ID set is explicit and additive:\n\n```text\n([\s\S]*?)\n```/)
  assert.ok(match, 'source spec must retain the explicit frozen capability block')
  return match[1].split(',').map((entry) => entry.trim()).filter(Boolean)
}

function resolveEmittedPath(relativePath: string): string {
  if (relativePath.startsWith('src/')) return path.join(TEMPLATE_ROOT, relativePath)
  if (relativePath.startsWith('node_modules/')) return path.join(WORKSPACE_ROOT, relativePath)
  if (relativePath.startsWith('.ai/')) {
    return path.join(CREATE_APP_ROOT, 'agentic/shared/ai', relativePath.slice('.ai/'.length))
  }
  throw new Error(`Unsupported reference inventory path: ${relativePath}`)
}

function listFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(root, entry.name)
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath]
  })
}

function resolveMarkdownLink(markdownPath: string, href: string): string {
  const decodedHref = decodeURIComponent(href)
  if (decodedHref.startsWith('../../../../node_modules/')) {
    return path.join(WORKSPACE_ROOT, decodedHref.slice('../../../../'.length))
  }
  if (decodedHref.includes('/.ai/')) {
    const skillPath = decodedHref.slice(decodedHref.indexOf('/.ai/') + '/.ai/'.length)
    return path.join(CREATE_APP_ROOT, 'agentic/shared/ai', skillPath)
  }
  return path.resolve(path.dirname(markdownPath), decodedHref)
}

test('failure-first inventory contract pins every frozen capability and rollout boundary', () => {
  const inventory = loadInventory()
  const expectedIds = frozenCapabilityIds()
  assert.equal(expectedIds.length, 105)
  assert.deepEqual(inventory.map((entry) => entry.capabilityId), expectedIds)
  assert.equal(new Set(inventory.map((entry) => entry.capabilityId)).size, inventory.length)

  for (const [index, entry] of inventory.entries()) {
    assert.ok(entry.owner.length > 0, `${entry.capabilityId}: owner is required`)
    assert.equal(Array.isArray(entry.paths) && entry.paths.length > 0, true, `${entry.capabilityId}: exact paths are required`)
    assert.equal(entry.paths.some((entryPath) => entryPath.includes('#L')), false, `${entry.capabilityId}: line anchors are forbidden`)
    assert.equal(fs.statSync(resolveEmittedPath(entry.owner)).isFile(), true, `${entry.capabilityId}: owner must exist`)

    const expectedCoverage = index < 87
      ? 'reference'
      : index < 102
        ? 'authoritative-source'
        : 'specialist-route'
    assert.equal(entry.coverageKind, expectedCoverage, `${entry.capabilityId}: frozen coverage kind changed`)

    if (entry.coverageKind === 'reference') {
      assert.ok(entry.rollout === 'implemented' || entry.rollout === 'planned')
      for (const entryPath of entry.paths) {
        assert.ok(entryPath === 'src/modules.ts' || entryPath.startsWith('src/modules/reference_module/'))
        if (entry.rollout === 'implemented') {
          assert.equal(fs.statSync(resolveEmittedPath(entryPath)).isFile(), true, `${entry.capabilityId}: implemented path must exist`)
        }
      }
    } else {
      assert.equal(entry.rollout, 'routed')
      for (const entryPath of entry.paths) {
        assert.equal(fs.statSync(resolveEmittedPath(entryPath)).isFile(), true, `${entry.capabilityId}: routed path must exist`)
      }
    }
  }
})

test('failure-first link contract requires a progressive exhaustive map with resolvable files', () => {
  const inventory = loadInventory()
  const readme = fs.readFileSync(README_PATH, 'utf8')
  const surfaceMap = fs.readFileSync(MAP_PATH, 'utf8')
  assert.match(readme, /source only/)
  assert.match(readme, /ratelimit_probe.*test fixture/)
  assert.match(readme, /yarn generate/)
  assert.match(surfaceMap, /planned.*not current coverage/)
  for (const entry of inventory) {
    assert.ok(surfaceMap.includes(`\`${entry.capabilityId}\``), `${entry.capabilityId}: missing from surface map`)
  }

  for (const markdownPath of [README_PATH, MAP_PATH]) {
    const markdown = fs.readFileSync(markdownPath, 'utf8')
    const links = [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1])
    assert.ok(links.length > 0, `${markdownPath}: expected file links`)
    for (const href of links) {
      assert.equal(href.includes('#L'), false, `${href}: line anchors are forbidden`)
      assert.equal(fs.statSync(resolveMarkdownLink(markdownPath, href)).isFile(), true, `${href}: link must resolve to a file`)
    }
  }
})

test('failure-first preset contract preserves the inert source without registration', () => {
  const templateModules = fs.readFileSync(path.join(TEMPLATE_ROOT, 'src/modules.ts'), 'utf8')
  assert.doesNotMatch(templateModules, /id:\s*['"]reference_module['"]/)
  assert.match(templateModules, /id:\s*['"]example['"]/)
  assert.match(templateModules, /id:\s*['"]ratelimit_probe['"]/)
  assert.equal(fs.statSync(REFERENCE_ROOT).isDirectory(), true)

  const fixtureRoot = path.join(WORKSPACE_ROOT, '.ai/tmp')
  fs.mkdirSync(fixtureRoot, { recursive: true })
  const expectedReadme = fs.readFileSync(README_PATH, 'utf8')
  const rateLimitSource = path.join(TEMPLATE_ROOT, 'src/modules/ratelimit_probe')
  const rateLimitRoute = path.join('src/modules/ratelimit_probe/api/ping/route.ts')
  const expectedRateLimitRoute = fs.readFileSync(path.join(TEMPLATE_ROOT, rateLimitRoute), 'utf8')

  for (const presetId of VALID_PRESET_IDS) {
    const preset = resolvePreset(presetId)
    assert.equal(preset.modules.some((entry) => entry.id === 'reference_module'), false, `${presetId}: reference module must stay disabled`)
    assert.equal(preset.filesToRemove.some((entry) => entry === 'src/modules/reference_module' || entry.startsWith('src/modules/reference_module/')), false, `${presetId}: reference source must be preserved`)

    const targetDir = fs.mkdtempSync(path.join(fixtureRoot, `reference-preset-${presetId}-`))
    try {
      fs.mkdirSync(path.join(targetDir, 'src/modules/example'), { recursive: true })
      fs.mkdirSync(path.join(targetDir, 'src/modules/example_customers_sync'), { recursive: true })
      fs.mkdirSync(path.join(targetDir, '.mercato'), { recursive: true })
      fs.cpSync(REFERENCE_ROOT, path.join(targetDir, 'src/modules/reference_module'), { recursive: true })
      fs.cpSync(rateLimitSource, path.join(targetDir, 'src/modules/ratelimit_probe'), { recursive: true })
      fs.writeFileSync(path.join(targetDir, 'src/modules.ts'), templateModules)
      applyStarterPreset(presetId, targetDir)
      assert.equal(fs.readFileSync(path.join(targetDir, 'src/modules/reference_module/README.md'), 'utf8'), expectedReadme)
      assert.equal(fs.readFileSync(path.join(targetDir, rateLimitRoute), 'utf8'), expectedRateLimitRoute)
      assert.doesNotMatch(fs.readFileSync(path.join(targetDir, 'src/modules.ts'), 'utf8'), /id:\s*['"]reference_module['"]/)
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
  }

  const rateLimitProbe = fs.readFileSync(path.join(TEMPLATE_ROOT, 'src/modules/ratelimit_probe/api/ping/route.ts'), 'utf8')
  assert.match(rateLimitProbe, /points:\s*3/)
  assert.match(rateLimitProbe, /duration:\s*60/)
  assert.match(rateLimitProbe, /keyPrefix:\s*['"]ratelimit_probe['"]/)
})

test('failure-first context contract enforces source and progressive-entrypoint budgets', () => {
  const files = listFiles(REFERENCE_ROOT)
  const totalBytes = files.reduce((total, filePath) => total + fs.statSync(filePath).size, 0)
  assert.ok(files.length <= 80, `reference source has ${files.length}/80 files`)
  assert.ok(totalBytes <= 512 * 1024, `reference source has ${totalBytes}/${512 * 1024} bytes`)
  assert.ok(fs.statSync(README_PATH).size <= 12 * 1024, 'README exceeds 12 KiB')
  assert.ok(fs.statSync(MAP_PATH).size <= 24 * 1024, 'surface map exceeds 24 KiB')

  for (const filePath of files.filter((entry) => /\.(?:ts|tsx)$/.test(entry))) {
    assert.ok(fs.statSync(filePath).size > 0, `${filePath}: empty source placeholders are forbidden`)
    if (fs.readFileSync(filePath, 'utf8').includes("'use client'")) {
      const lineCount = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length
      assert.ok(lineCount <= 300, `${filePath}: client component has ${lineCount}/300 lines`)
    }
  }
})
