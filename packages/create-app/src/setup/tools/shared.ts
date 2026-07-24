import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Project, SyntaxKind } from 'ts-morph'
import type { AgenticConfig } from '../wizard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In the bundled output (dist/index.js), __dirname is dist/.
// agentic/ is copied to dist/agentic/ by build.mjs.
const bundledAgenticRoot = join(__dirname, 'agentic')
const AGENTIC_ROOT = existsSync(bundledAgenticRoot)
  ? bundledAgenticRoot
  : join(__dirname, '..', '..', '..', 'agentic')
const AGENTIC_DIR = join(AGENTIC_ROOT, 'shared')
const GUIDES_DIR = join(AGENTIC_ROOT, 'guides')

function resolvePlaceholders(content: string, config: AgenticConfig): string {
  return content.replace(/\{\{PROJECT_NAME\}\}/g, config.projectName)
}

// AST-parse the static `enabledModules` array literal in the scaffolded app's
// src/modules.ts and collect each entry's `id`. Only the static literal is read
// (conditional .push()/spread entries are intentionally not seen — see spec D6).
function tryReadEnabledModuleIds(modulesPath: string): { parsed: boolean; ids: string[] } {
  if (!existsSync(modulesPath)) return { parsed: false, ids: [] }
  try {
    const project = new Project({ useInMemoryFileSystem: true })
    const sourceFile = project.createSourceFile('modules.ts', readFileSync(modulesPath, 'utf-8'))
    const declaration = sourceFile.getVariableDeclaration('enabledModules')
    const arrayLiteral = declaration?.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression)
    if (!arrayLiteral) return { parsed: false, ids: [] }
    const ids: string[] = []
    for (const element of arrayLiteral.getElements()) {
      const objectLiteral = element.asKind(SyntaxKind.ObjectLiteralExpression)
      if (!objectLiteral) continue
      const idProperty = objectLiteral.getProperty('id')?.asKind(SyntaxKind.PropertyAssignment)
      const idValue = idProperty?.getInitializerIfKind(SyntaxKind.StringLiteral)?.getLiteralValue()
      if (idValue) ids.push(idValue)
    }
    return { parsed: true, ids }
  } catch {
    return { parsed: false, ids: [] }
  }
}

export function readEnabledModuleIds(modulesPath: string): string[] {
  return tryReadEnabledModuleIds(modulesPath).ids
}

// Resolve which per-module fact-sheets to ship: the intersection of the bundled
// fact-sheets (the D5 allowlist, materialized by build.mjs) with the app's enabled
// modules. Falls back to the full bundled set when the enabled set cannot be read
// (R5 — degraded, never empty).
export function selectModuleFactSheets(targetDir: string, modulesSubdir: string): string[] {
  const available = existsSync(modulesSubdir)
    ? readdirSync(modulesSubdir)
        .filter((file) => file.endsWith('.md'))
        .map((file) => file.replace(/\.md$/, ''))
    : []
  if (available.length === 0) return []
  const parsed = tryReadEnabledModuleIds(join(targetDir, 'src', 'modules.ts'))
  if (!parsed.parsed) return available
  const enabled = new Set(parsed.ids)
  const selected = available.filter((moduleId) => enabled.has(moduleId))
  return selected
}

const MODULE_GUIDES_START = '<!-- om:module-guides:start -->'
const MODULE_GUIDES_END = '<!-- om:module-guides:end -->'

// Read each module's guide label from the bundled `module-facts.json` (emitted by
// build.mjs from the generator's extraction of each module's own `metadata`). The
// label falls back description → title → generic, so create-app never re-declares
// specific module names or descriptions. A missing/malformed sidecar degrades to an
// empty map (generic labels), never a throw.
export function readModuleGuideLabels(guidesDir: string): Record<string, string> {
  const factsPath = join(guidesDir, 'module-facts.json')
  if (!existsSync(factsPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(factsPath, 'utf-8')) as Record<
      string,
      { description?: unknown; title?: unknown }
    >
    const labels: Record<string, string> = {}
    for (const [moduleId, entry] of Object.entries(parsed)) {
      const label =
        (entry && typeof entry.description === 'string' && entry.description) ||
        (entry && typeof entry.title === 'string' && entry.title) ||
        ''
      if (label) labels[moduleId] = label
    }
    return labels
  } catch {
    return {}
  }
}

function renderModuleGuidesBlock(selected: string[], labels: Record<string, string>): string {
  if (selected.length === 0) return '_No module fact-sheets are bundled for this app._'
  const rows = selected.map((moduleId) => {
    const label = labels[moduleId] ?? `Use the ${moduleId} module`
    return `| ${label} | \`.ai/guides/modules/${moduleId}.md\` |`
  })
  return ['| Task | Load |', '|---|---|', ...rows].join('\n')
}

// Regenerate the marker-delimited Module-Specific Guides block in the written
// AGENTS.md from the selected module set. Replaces strictly between the markers so
// surrounding prose is untouched and repeat runs are idempotent.
export function injectModuleGuides(
  agentsMdPath: string,
  selected: string[],
  labels: Record<string, string> = {},
): void {
  if (!existsSync(agentsMdPath)) return
  const content = readFileSync(agentsMdPath, 'utf-8')
  const startIndex = content.indexOf(MODULE_GUIDES_START)
  const endIndex = content.indexOf(MODULE_GUIDES_END)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    console.warn(
      `[agentic] Module-Specific Guides markers (${MODULE_GUIDES_START} … ${MODULE_GUIDES_END}) not found in ${agentsMdPath}; the per-module guide list was not generated.`,
    )
    return
  }
  const before = content.slice(0, startIndex + MODULE_GUIDES_START.length)
  const after = content.slice(endIndex)
  const next = `${before}\n${renderModuleGuidesBlock(selected, labels)}\n${after}`
  if (next !== content) writeFileSync(agentsMdPath, next)
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function writeTemplate(srcRelative: string, destPath: string, config: AgenticConfig): void {
  const srcPath = join(AGENTIC_DIR, srcRelative)
  const content = readFileSync(srcPath, 'utf-8')
  ensureDir(destPath)
  writeFileSync(destPath, resolvePlaceholders(content, config))
}

const TEXT_EXTENSIONS = new Set(['.cjs', '.json', '.md', '.mdc', '.mjs', '.sh', '.ts', '.txt'])

function isTextAsset(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot === -1 || TEXT_EXTENSIONS.has(path.slice(dot))
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(absolute))
    } else if (entry.isFile()) {
      files.push(absolute)
    }
  }
  return files
}

function copyTree(sourceRoot: string, destinationRoot: string, config: AgenticConfig): void {
  for (const sourcePath of listFiles(sourceRoot)) {
    const destinationPath = join(destinationRoot, relative(sourceRoot, sourcePath))
    ensureDir(destinationPath)
    if (isTextAsset(sourcePath)) {
      writeFileSync(destinationPath, resolvePlaceholders(readFileSync(sourcePath, 'utf8'), config))
    } else {
      copyFileSync(sourcePath, destinationPath)
    }
  }
}

function targetPathsForTree(sourceRoot: string, destinationRoot: string): string[] {
  return listFiles(sourceRoot).map((sourcePath) => join(destinationRoot, relative(sourceRoot, sourcePath)))
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function harnessGeneratorId(): string {
  try {
    const upstream = JSON.parse(readFileSync(join(GUIDES_DIR, 'upstream', 'manifest.json'), 'utf8')) as {
      generator?: unknown
    }
    const generator = typeof upstream.generator === 'string' ? upstream.generator : ''
    const version = generator.slice(generator.lastIndexOf('@') + 1)
    if (version && version !== generator) return `open-mercato-agentic@${version}`
  } catch {
    // Source-mode tests may not have built upstream snapshots yet.
  }
  return 'open-mercato-agentic@unknown'
}

function externalSkillNames(targetDir: string): Set<string> {
  try {
    const tiers = JSON.parse(readFileSync(join(targetDir, '.ai', 'skills', 'tiers.json'), 'utf8')) as {
      external?: { skills?: unknown }
    }
    return new Set(Array.isArray(tiers.external?.skills) ? tiers.external.skills.filter((name): name is string => typeof name === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Finalize ownership only after tool patching and agent-selection persistence. */
export function finalizeHarnessManifest(config: AgenticConfig, selectedTools: string[]): void {
  const { targetDir } = config
  const selectedModules = selectModuleFactSheets(targetDir, join(GUIDES_DIR, 'modules'))
  const paths = new Set<string>([
    join(targetDir, 'AGENTS.md'),
    ...targetPathsForTree(join(AGENTIC_DIR, 'ai'), join(targetDir, '.ai')),
    ...targetPathsForTree(join(AGENTIC_DIR, 'scripts'), join(targetDir, 'scripts')),
  ])

  for (const file of readdirSync(GUIDES_DIR)) {
    if (file.endsWith('.md') || file === 'module-facts.json') paths.add(join(targetDir, '.ai', 'guides', file))
  }
  for (const file of listFiles(join(GUIDES_DIR, 'upstream'))) {
    paths.add(join(targetDir, '.ai', 'guides', 'upstream', relative(join(GUIDES_DIR, 'upstream'), file)))
  }
  for (const moduleId of selectedModules) paths.add(join(targetDir, '.ai', 'guides', 'modules', `${moduleId}.md`))

  if (selectedTools.includes('claude-code')) {
    paths.add(join(targetDir, 'CLAUDE.md'))
    paths.add(join(targetDir, '.claude', 'settings.json'))
    paths.add(join(targetDir, '.claude', 'hooks', 'entity-migration-check.ts'))
    paths.add(join(targetDir, '.mcp.json.example'))
  }
  if (selectedTools.includes('codex')) paths.add(join(targetDir, '.codex', 'mcp.json.example'))
  if (selectedTools.includes('cursor')) {
    for (const file of listFiles(join(AGENTIC_ROOT, 'cursor'))) {
      const rel = relative(join(AGENTIC_ROOT, 'cursor'), file)
      const mapped = rel === 'mcp.json.example' ? join(targetDir, '.cursor', 'mcp.json.example') : join(targetDir, '.cursor', rel)
      paths.add(mapped)
    }
  }

  const manifestPath = join(targetDir, '.ai', 'harness', 'manifest.json')
  const externalSkills = externalSkillNames(targetDir)
  paths.delete(manifestPath)
  const files = [...paths]
    .filter((path) => existsSync(path))
    .sort()
    .map((path) => {
      const relativePath = relative(targetDir, path).replace(/\\/g, '/')
      const skillName = relativePath.match(/^\.ai\/skills\/([^/]+)\//)?.[1]
      return {
        path: relativePath,
        sha256: hashFile(path),
        source: skillName ? (externalSkills.has(skillName) ? 'external-override' : 'local-skill') : 'generated',
        userEditable: relativePath === 'AGENTS.md' || relativePath === '.ai/agentic.config.json' || relativePath === '.ai/lessons.md',
      }
    })
  ensureDir(manifestPath)
  const temporaryManifestPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(temporaryManifestPath, `${JSON.stringify({ version: 1, generator: harnessGeneratorId(), files }, null, 2)}\n`)
    renameSync(temporaryManifestPath, manifestPath)
  } finally {
    rmSync(temporaryManifestPath, { force: true })
  }
}

export function generateShared(config: AgenticConfig): void {
  const { targetDir } = config

  // Resolve which per-module fact-sheets this app gets (enabled ∩ bundled allowlist).
  const selectedModules = selectModuleFactSheets(targetDir, join(GUIDES_DIR, 'modules'))
  const moduleGuideLabels = readModuleGuideLabels(GUIDES_DIR)

  // One recursive mapping owns all shared harness assets. This intentionally
  // replaces the former per-skill copy list so new references/evals/scripts are
  // emitted automatically by both create-app and the CLI mirror.
  writeTemplate('AGENTS.md.template', join(targetDir, 'AGENTS.md'), config)
  copyTree(join(AGENTIC_DIR, 'ai'), join(targetDir, '.ai'), config)
  copyTree(join(AGENTIC_DIR, 'scripts'), join(targetDir, 'scripts'), config)

  // Package & conceptual guides are copied wholesale (framework-wide). Per-module
  // fact-sheets (.ai/guides/modules/<module>.md) are filtered to the app's enabled
  // module set; the combined module-facts.json sidecar is copied as-is.
  if (existsSync(GUIDES_DIR)) {
    const guidesDestDir = join(targetDir, '.ai', 'guides')
    for (const file of readdirSync(GUIDES_DIR)) {
      if (file.endsWith('.md')) {
        const destPath = join(guidesDestDir, file)
        ensureDir(destPath)
        copyFileSync(join(GUIDES_DIR, file), destPath)
      }
    }

    const moduleFactsPath = join(GUIDES_DIR, 'module-facts.json')
    if (existsSync(moduleFactsPath)) {
      const destPath = join(guidesDestDir, 'module-facts.json')
      ensureDir(destPath)
      copyFileSync(moduleFactsPath, destPath)
    }

    copyTree(join(GUIDES_DIR, 'upstream'), join(guidesDestDir, 'upstream'), config)

    const modulesSubdir = join(GUIDES_DIR, 'modules')
    for (const moduleId of selectedModules) {
      const destPath = join(guidesDestDir, 'modules', `${moduleId}.md`)
      ensureDir(destPath)
      copyFileSync(join(modulesSubdir, `${moduleId}.md`), destPath)
    }
  }

  injectModuleGuides(join(targetDir, 'AGENTS.md'), selectedModules, moduleGuideLabels)
}
