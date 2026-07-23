import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The standalone template mirrors apps/mercato's dependency shape (see the
// Template Sync Checklist in AGENTS.md). When the monorepo bumps a shared
// dependency (especially a major like ai@6→7) without mirroring the template,
// freshly scaffolded apps install framework packages compiled against a
// different SDK major and fail to build. These tests fail the moment the two
// manifests drift on a shared key, or a template-only pin falls behind the
// major some @open-mercato package actually requires.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

type Manifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  resolutions?: Record<string, string>
}

function readManifest(filePath: string): Manifest {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\{\{[A-Z_]+\}\}/g, '0.0.0')
  return JSON.parse(raw) as Manifest
}

const template = readManifest(
  path.join(REPO_ROOT, 'packages', 'create-app', 'template', 'package.json.template'),
)
const app = readManifest(path.join(REPO_ROOT, 'apps', 'mercato', 'package.json'))

function rangeMajor(range: string): string | null {
  const match = range.match(/(\d+)/)
  return match ? match[1] : null
}

test('template dependency pins match apps/mercato for every shared key', () => {
  const drift: string[] = []
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const templateSection = template[section] ?? {}
    const appSection = app[section] ?? {}
    for (const [name, templateRange] of Object.entries(templateSection)) {
      if (name.startsWith('@open-mercato/')) continue
      const appRange = appSection[name]
      if (appRange && appRange !== templateRange) {
        drift.push(`${section}.${name}: template ${templateRange} vs apps/mercato ${appRange}`)
      }
    }
  }
  assert.deepEqual(
    drift,
    [],
    `Template pins drifted from apps/mercato — mirror the bump into package.json.template:\n${drift.join('\n')}`,
  )
})

test('template-only pins track the majors the @open-mercato packages require', () => {
  const templateDeps = { ...(template.dependencies ?? {}), ...(template.devDependencies ?? {}) }
  const appDeps = { ...(app.dependencies ?? {}), ...(app.devDependencies ?? {}) }
  const requiredRanges = new Map<string, Set<string>>()
  const packagesDir = path.join(REPO_ROOT, 'packages')
  for (const entry of fs.readdirSync(packagesDir)) {
    const manifestPath = path.join(packagesDir, entry, 'package.json')
    if (!fs.existsSync(manifestPath)) continue
    const manifest = readManifest(manifestPath)
    for (const section of ['dependencies', 'peerDependencies'] as const) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (!(name in templateDeps) || name in appDeps) continue
        if (!requiredRanges.has(name)) requiredRanges.set(name, new Set())
        requiredRanges.get(name)?.add(range)
      }
    }
  }
  const drift: string[] = []
  for (const [name, ranges] of requiredRanges) {
    const templateMajor = rangeMajor(templateDeps[name])
    const requiredMajors = [...ranges].map(rangeMajor).filter(Boolean)
    if (templateMajor && requiredMajors.length > 0 && !requiredMajors.includes(templateMajor)) {
      drift.push(
        `${name}: template pins major ${templateMajor} (${templateDeps[name]}) but @open-mercato packages require ${[...ranges].join(', ')}`,
      )
    }
  }
  assert.deepEqual(
    drift,
    [],
    `Template-only pins are on a different major than the framework packages require:\n${drift.join('\n')}`,
  )
})

test('template resolutions do not force a version outside the declared dependency range major', () => {
  const drift: string[] = []
  const templateDeps = { ...(template.dependencies ?? {}), ...(template.devDependencies ?? {}) }
  for (const [name, forced] of Object.entries(template.resolutions ?? {})) {
    const declared = templateDeps[name]
    if (!declared) continue
    const forcedMajor = rangeMajor(forced)
    const declaredMajor = rangeMajor(declared)
    if (forcedMajor && declaredMajor && forcedMajor !== declaredMajor) {
      drift.push(`${name}: resolution ${forced} vs dependency ${declared}`)
    }
    const appResolution = (app.resolutions ?? {})[name]
    const rootResolution = readManifest(path.join(REPO_ROOT, 'package.json')).resolutions?.[name]
    const reference = appResolution ?? rootResolution
    if (reference && reference !== forced) {
      drift.push(`${name}: template resolution ${forced} vs monorepo resolution ${reference}`)
    }
  }
  assert.deepEqual(
    drift,
    [],
    `Template resolutions conflict with the declared dependency versions:\n${drift.join('\n')}`,
  )
})
