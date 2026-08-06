import * as esbuild from 'esbuild'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join, basename, resolve } from 'path'
import { describeMissingSiblingBuild } from './scripts/sibling-build.mjs'

const shebang = '#!/usr/bin/env node\n'

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outdir: 'dist',
  packages: 'external',
  banner: {
    js: shebang,
  },
})

// Make the output executable
chmodSync('dist/index.js', 0o755)

// Copy lib template assets to dist/ so they can be read at runtime
if (existsSync('src/lib/templates')) {
  cpSync('src/lib/templates', 'dist/templates', { recursive: true })
  console.log('Copied src/lib/templates/ → dist/templates/')
}

// Copy agentic source content to dist/ so generators can read it at runtime.
// The tree is assembled in a staging directory and swapped in at the end of the build: refreshing
// dist/agentic in place deletes the whole harness plus ~55 fact-sheets and copies them back, which
// leaves the published tree incomplete for seconds and makes any concurrent reader fail with ENOENT
// on files that exist (#5059). Staging also makes stale per-module artifacts structurally impossible,
// so no purge of previous output is needed — the swapped-in tree only contains what this build wrote.
// The staging and previous directory names are fixed, so a single builder at a time is an assumption
// of this design: two concurrent runs would clear each other's staging tree below and the loser would
// fail loudly on the rename at the end. Nothing in the repository builds this package concurrently
// any more — removing that is what this change is for — and a loud failure beats the silent partial
// tree the in-place refresh produced.
const agenticDist = join('dist', 'agentic')
const agenticStaging = join('dist', 'agentic.staging')
const agenticPrevious = join('dist', 'agentic.previous')
for (const leftover of [agenticStaging, agenticPrevious]) rmSync(leftover, { recursive: true, force: true })
mkdirSync(agenticStaging, { recursive: true })
if (existsSync('agentic')) {
  cpSync('agentic', agenticStaging, { recursive: true })
  console.log('Copied agentic/ → dist/agentic.staging/')
}

// Bundle the release-matched upstream instruction boundary used by standalone
// apps when installed package/module context is not enough. Both files remain
// read-only reference material in the generated app.
const repositoryRoot = resolve('..', '..')
const upstreamDir = join(agenticStaging, 'guides', 'upstream')
mkdirSync(upstreamDir, { recursive: true })
const createAppVersion = JSON.parse(readFileSync('package.json', 'utf8')).version ?? null
const upstreamManifest = { version: 1, generator: `create-mercato-app@${createAppVersion ?? 'unknown'}`, files: {} }
for (const file of ['AGENTS.md', 'BACKWARD_COMPATIBILITY.md']) {
  const source = join(repositoryRoot, file)
  const destination = join(upstreamDir, file)
  cpSync(source, destination)
  upstreamManifest.files[file] = createHash('sha256').update(readFileSync(source)).digest('hex')
}
writeFileSync(join(upstreamDir, 'manifest.json'), `${JSON.stringify(upstreamManifest, null, 2)}\n`)

// Auto-discover module-specific standalone guides from sibling packages.
// Package-level guides are intentionally not shipped: the routed conceptual guides and
// generated module fact-sheets are the standalone sources of truth.
const packagesDir = join('..') // packages/create-app/.. = packages/
const guidesDestDir = join(agenticStaging, 'guides')
mkdirSync(guidesDestDir, { recursive: true })

// Nothing stale can survive here: the staged tree is built from `agentic/` alone, so the legacy
// `core.<module>.md` redirect stubs (#3754) and the unreachable package-level `<pkg>.md` guides are
// absent unless this build writes them — which it does not. The conceptual `module-system.md` remains.

let guidesFound = 0
for (const pkg of readdirSync(packagesDir)) {
  // Module-level guides: packages/<pkg>/src/modules/<mod>/agentic/standalone-guide.md → <pkg>.<mod>.md
  // Package-level source guides stay monorepo-only: standalone apps route through the conceptual
  // guides and the generated module fact-sheets, so they are never emitted into the staged tree.
  const modulesDir = join(packagesDir, pkg, 'src', 'modules')
  if (!existsSync(modulesDir)) continue
  for (const mod of readdirSync(modulesDir)) {
    const moduleGuideSource = join(modulesDir, mod, 'agentic', 'standalone-guide.md')
    if (existsSync(moduleGuideSource)) {
      cpSync(moduleGuideSource, join(guidesDestDir, `${pkg}.${mod}.md`))
      guidesFound++
    }
  }
}
if (guidesFound > 0) {
  console.log(`Discovered ${guidesFound} standalone guides → dist/agentic/guides/`)
}

// Generate per-module fact-sheets (Layer 2) for every package-provided module via
// the reusable ts-morph extractor + resolver-routed discovery in @open-mercato/cli.
// Emits one markdown sheet per discovered module plus a combined JSON sidecar; a
// scaffold links only its enabled subset (packages/create-app/src/setup/tools/shared.ts).
// Auth comes from the generated module registry (`apis[].metadata`); a missing registry
// yields warnings, never a crash. Discovery goes through the resolver, never a hardcoded
// packages/* path (.ai/lessons/standalone-scaffolding-and-generators-must-not-assume.md).
let extractAllModuleFacts
let renderModuleFactsJson
let discoverPackageModuleSources
let createResolver
try {
  ;({ extractAllModuleFacts, renderModuleFactsJson } = await import(
    '@open-mercato/cli/lib/generators/module-facts'
  ))
  ;({ discoverPackageModuleSources } = await import(
    '@open-mercato/cli/lib/generators/module-facts-discovery'
  ))
  ;({ createResolver } = await import('@open-mercato/cli/lib/resolver'))
} catch (error) {
  throw describeMissingSiblingBuild(error) ?? error
}

const sources = discoverPackageModuleSources(createResolver(resolve(packagesDir, '..')))
if (sources.length > 0) {
  const registryPath = join(packagesDir, '..', 'apps', 'mercato', '.mercato', 'generated', 'modules.runtime.generated.ts')
  let coreVersion = null
  try {
    coreVersion = JSON.parse(readFileSync(join(packagesDir, 'core', 'package.json'), 'utf8')).version ?? null
  } catch {
    coreVersion = null
  }

  const { factsByModule, markdownByModule, frameworkMarkdown, warnings } = extractAllModuleFacts({
    sources,
    registryPath: existsSync(registryPath) ? registryPath : null,
    coreVersion,
  })

  const modulesGuidesDir = join(guidesDestDir, 'modules')
  mkdirSync(modulesGuidesDir, { recursive: true })
  for (const [moduleId, markdown] of Object.entries(markdownByModule)) {
    writeFileSync(join(modulesGuidesDir, `${moduleId}.md`), markdown)
  }
  writeFileSync(join(guidesDestDir, 'module-facts.json'), renderModuleFactsJson(factsByModule))
  writeFileSync(join(guidesDestDir, 'framework-extension-points.md'), frameworkMarkdown)

  for (const warning of warnings) console.warn(warning)
  console.log(`Generated ${Object.keys(markdownByModule).length} module fact-sheets → dist/agentic.staging/guides/modules/`)
} else {
  console.warn('[module-facts] no package modules discovered; skipping fact-sheet generation')
}

// Publish the staged tree. A reader either sees the complete previous build or the complete new
// one; the only gap is between the two renames, instead of the multi-second incomplete window an
// in-place refresh leaves behind (#5059).
if (existsSync(agenticDist)) renameSync(agenticDist, agenticPrevious)
renameSync(agenticStaging, agenticDist)
rmSync(agenticPrevious, { recursive: true, force: true })

console.log('Build complete: dist/index.js')
