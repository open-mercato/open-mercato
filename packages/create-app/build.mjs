import * as esbuild from 'esbuild'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join, basename } from 'path'

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

// Copy agentic source content to dist/ so generators can read it at runtime
if (existsSync('agentic')) {
  cpSync('agentic', 'dist/agentic', { recursive: true })
  console.log('Copied agentic/ → dist/agentic/')
}

// Auto-discover standalone guides from sibling packages
// Each package can provide packages/<name>/agentic/standalone-guide.md
const packagesDir = join('..') // packages/create-app/.. = packages/
const guidesDestDir = join('dist', 'agentic', 'guides')
mkdirSync(guidesDestDir, { recursive: true })

// Clean stale per-module artifacts before regenerating so an incremental dist never
// retains a removed module's full guide or fact-sheet — a removed `core.<module>.md`
// (two-dot, per-module) must come back as a redirect stub, not linger as a full guide.
// The conceptual `module-system.md` and the single-dot package guides (`core.md`, …) are
// re-emitted below (or copied from `agentic/`), so they are intentionally left alone here.
rmSync(join(guidesDestDir, 'modules'), { recursive: true, force: true })
for (const entry of readdirSync(guidesDestDir)) {
  if (/^core\..+\.md$/.test(entry)) {
    rmSync(join(guidesDestDir, entry))
  }
}

let guidesFound = 0
for (const pkg of readdirSync(packagesDir)) {
  // Package-level guide: packages/<pkg>/agentic/standalone-guide.md → <pkg>.md
  const guideSource = join(packagesDir, pkg, 'agentic', 'standalone-guide.md')
  if (existsSync(guideSource)) {
    cpSync(guideSource, join(guidesDestDir, `${pkg}.md`))
    guidesFound++
  }

  // Module-level guides: packages/<pkg>/src/modules/<mod>/agentic/standalone-guide.md → <pkg>.<mod>.md
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

// Generate per-module fact-sheets (Layer 2) from core module sources via the
// reusable ts-morph extractor in @open-mercato/cli. Emits one markdown sheet per
// allowlisted module plus a combined JSON sidecar. Auth comes from the generated
// module registry (`apis[].metadata`); a missing registry yields warnings, never a crash.
const { extractAllModuleFacts, renderModuleFactsJson } = await import(
  '@open-mercato/cli/lib/generators/module-facts'
)
const coreSrcRoot = join(packagesDir, 'core', 'src', 'modules')
if (existsSync(coreSrcRoot)) {
  const registryPath = join(packagesDir, '..', 'apps', 'mercato', '.mercato', 'generated', 'modules.runtime.generated.ts')
  let coreVersion = null
  try {
    coreVersion = JSON.parse(readFileSync(join(packagesDir, 'core', 'package.json'), 'utf8')).version ?? null
  } catch {
    coreVersion = null
  }

  const { factsByModule, markdownByModule, warnings } = extractAllModuleFacts({
    coreSrcRoot,
    registryPath: existsSync(registryPath) ? registryPath : null,
    coreVersion,
  })

  const modulesGuidesDir = join(guidesDestDir, 'modules')
  mkdirSync(modulesGuidesDir, { recursive: true })
  for (const [moduleId, markdown] of Object.entries(markdownByModule)) {
    writeFileSync(join(modulesGuidesDir, `${moduleId}.md`), markdown)
  }
  writeFileSync(join(guidesDestDir, 'module-facts.json'), renderModuleFactsJson(factsByModule))

  for (const warning of warnings) console.warn(warning)
  console.log(`Generated ${Object.keys(markdownByModule).length} module fact-sheets → dist/agentic/guides/modules/`)

  // BC bridge (spec §7 generated-file contract): for any allowlisted module whose
  // legacy full guide `core.<module>.md` is no longer bundled (its standalone-guide.md
  // source was removed), emit a thin redirect stub pointing at the generated fact-sheet.
  // Fresh scaffolds never link these names; they exist only for apps upgrading in place.
  let stubsWritten = 0
  for (const moduleId of Object.keys(markdownByModule)) {
    const legacyGuidePath = join(guidesDestDir, `core.${moduleId}.md`)
    if (!existsSync(legacyGuidePath)) {
      writeFileSync(
        legacyGuidePath,
        `# core.${moduleId} — moved\n\n` +
          `> This guide has moved. See [\`modules/${moduleId}.md\`](modules/${moduleId}.md) for the generated ` +
          `\`${moduleId}\` fact-sheet, and [\`module-system.md\`](module-system.md) for conceptual module guidance.\n`,
      )
      stubsWritten++
    }
  }
  if (stubsWritten > 0) {
    console.log(`Wrote ${stubsWritten} legacy core.<module>.md redirect stubs → dist/agentic/guides/`)
  }
} else {
  console.warn(`[module-facts] core module sources not found at ${coreSrcRoot}; skipping fact-sheet generation`)
}

console.log('Build complete: dist/index.js')
