/**
 * `yarn ds:mockups:draft <flow-file> [--force]` — turns a validated
 * `*.flow.json` outline (the `om-ux-flows` artifact) into draft mockup
 * documents under `.ai/mockups/` (spec
 * `.ai/specs/2026-07-05-ds-live-mockup-composer.md`, Phase 3).
 *
 * Every generated document is `draft: true` with all blocks
 * `status: 'proposed'` — a human always reviews; nothing auto-finalizes.
 * Existing non-draft documents are never overwritten; existing drafts
 * regenerate only with `--force` (drafts regenerate only on request).
 */
import fs from 'node:fs'
import path from 'node:path'
import { flowOutline } from '../packages/core/src/modules/design_system/mockups/flow'
import { generateDraftDocuments } from '../packages/core/src/modules/design_system/mockups/generation'
import { checkMockupIntegrity, loadGalleryEntryMap } from '../packages/core/src/modules/design_system/mockups/integrity'
import { findRepoRoot, loadMockupFile } from '../packages/core/src/modules/design_system/mockups/loader'

function fail(message: string): never {
  console.error(`ds:mockups:draft: ${message}`)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const flowFile = args.find((arg) => !arg.startsWith('-'))
  if (!flowFile) fail('usage: yarn ds:mockups:draft <flow-file> [--force]')

  const repoRoot = findRepoRoot(__dirname)
  if (!repoRoot) fail('could not locate the repo root (yarn.lock not found)')

  const flowPath = path.resolve(process.cwd(), flowFile)
  if (!fs.existsSync(flowPath)) fail(`flow file not found: ${flowPath}`)

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(flowPath, 'utf8'))
  } catch (error) {
    fail(`invalid JSON in ${flowPath}: ${(error as Error).message}`)
  }
  const parsed = flowOutline.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    }
    fail(`flow outline fails schema validation (${parsed.error.issues.length} issue(s))`)
  }

  const entries = await loadGalleryEntryMap()
  const { documents, notes } = generateDraftDocuments(parsed.data, new Set(entries.keys()))

  // Belt and braces: generated documents must pass the same registry
  // integrity gate as committed ones before anything touches disk.
  for (const document of documents) {
    const issues = checkMockupIntegrity(document, entries)
    if (issues.length > 0) {
      for (const issue of issues) console.error(`  ${issue.blockId}: ${issue.message}`)
      fail(`generated document "${document.slug}" fails registry integrity — this is a generator bug`)
    }
  }

  const outDir = path.join(repoRoot, '.ai', 'mockups')
  fs.mkdirSync(outDir, { recursive: true })

  for (const document of documents) {
    const outPath = path.join(outDir, `${document.slug}.mockup.json`)
    if (fs.existsSync(outPath)) {
      const existing = loadMockupFile(outPath, 'ai')
      if (!existing.draft) {
        fail(
          `refusing to overwrite ${outPath} (the existing document is not a draft): hand-edited mockups are never regenerated`,
        )
      }
      if (!force) {
        fail(`refusing to overwrite draft ${outPath}, pass --force to regenerate it`)
      }
    }
    fs.writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    console.log(`Draft written: ${outPath}`)
    console.log(`  Review it at /backend/design-system/mockups/${document.slug}`)
  }
  for (const note of notes) console.log(`Note: ${note}`)
  console.log(
    'Drafts carry draft: true and all blocks are status "proposed": review with om-ux-heuristics/om-ux-copy, then finalize explicitly (the flag never clears itself).',
  )
}

void main()
