import * as esbuild from 'esbuild'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
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
} else {
  console.warn(`[module-facts] core module sources not found at ${coreSrcRoot}; skipping fact-sheet generation`)
}

console.log('Build complete: dist/index.js')
