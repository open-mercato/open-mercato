/**
 * Agentic setup for the CLI `agentic:init` command.
 *
 * Source files live in packages/create-app/agentic/ and are copied
 * to packages/cli/dist/agentic/ during build (see build.mjs).
 * This module reads those files at runtime — no embedded string constants.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname, basename, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Project, SyntaxKind } from 'ts-morph'

const moduleDir = dirname(fileURLToPath(import.meta.url))
// In the built output (dist/lib/agentic-setup.js), moduleDir is dist/lib/.
// agentic/ is copied to dist/agentic/ by build.mjs.
const bundledAgenticDir = join(moduleDir, '..', 'agentic')
const AGENTIC_DIR = existsSync(bundledAgenticDir)
  ? bundledAgenticDir
  : join(moduleDir, '..', '..', '..', 'create-app', 'agentic')
const GUIDES_DIR = join(AGENTIC_DIR, 'guides')

type AskFn = (question: string) => Promise<string>

interface AgenticSetupOptions {
  tool?: string
  force?: boolean
  updateHarness?: boolean
}

interface AgenticConfig {
  projectName: string
  targetDir: string
}

interface HarnessManifestFile {
  path: string
  sha256: string
  source: string
  userEditable: boolean
}

interface HarnessManifest {
  version: number
  generator: string
  files: HarnessManifestFile[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function resolvePlaceholders(content: string, config: AgenticConfig): string {
  return content.replace(/\{\{PROJECT_NAME\}\}/g, config.projectName)
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function writeTemplate(srcDir: string, srcRelative: string, destPath: string, config: AgenticConfig): void {
  const srcPath = join(srcDir, srcRelative)
  const content = readFileSync(srcPath, 'utf-8')
  ensureDir(destPath)
  writeFileSync(destPath, resolvePlaceholders(content, config))
}

function copyFile(srcDir: string, srcRelative: string, destPath: string): void {
  const srcPath = join(srcDir, srcRelative)
  ensureDir(destPath)
  copyFileSync(srcPath, destPath)
}

// ─── Module fact-sheet selection (mirrors packages/create-app/src/setup/tools/shared.ts) ──

// AST-parse the static `enabledModules` array literal in the app's src/modules.ts
// and collect each entry's `id`. Only the static literal is read (conditional
// .push()/spread entries are intentionally not seen — see spec D6).
function readEnabledModuleIds(modulesPath: string): { parsed: boolean; ids: string[] } {
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

// Resolve which per-module fact-sheets to ship: the intersection of the bundled
// fact-sheets (the D5 allowlist, materialized by build.mjs) with the app's enabled
// modules. Falls back to the full bundled set when the enabled set cannot be read
// (R5 — degraded, never empty).
function selectModuleFactSheets(targetDir: string, modulesSubdir: string): string[] {
  const available = existsSync(modulesSubdir)
    ? readdirSync(modulesSubdir)
        .filter((file) => file.endsWith('.md'))
        .map((file) => file.replace(/\.md$/, ''))
    : []
  if (available.length === 0) return []
  const parsed = readEnabledModuleIds(join(targetDir, 'src', 'modules.ts'))
  if (!parsed.parsed) return available
  const enabled = new Set(parsed.ids)
  const selected = available.filter((moduleId) => enabled.has(moduleId))
  return selected
}

const MODULE_GUIDES_START = '<!-- om:module-guides:start -->'
const MODULE_GUIDES_END = '<!-- om:module-guides:end -->'

// Read each module's guide label from the bundled `module-facts.json` (emitted by
// build.mjs from the generator's extraction of each module's own `metadata`). The
// label falls back description → title → generic, so the CLI never re-declares
// specific module names or descriptions. A missing/malformed sidecar degrades to an
// empty map (generic labels), never a throw.
function readModuleGuideLabels(guidesDir: string): Record<string, string> {
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
function injectModuleGuides(
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
    if (entry.isDirectory()) files.push(...listFiles(absolute))
    else if (entry.isFile()) files.push(absolute)
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

function atomicCopyFile(sourcePath: string, destinationPath: string): void {
  ensureDir(destinationPath)
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`
  try {
    copyFileSync(sourcePath, temporaryPath)
    renameSync(temporaryPath, destinationPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function atomicWriteFile(destinationPath: string, content: string): void {
  ensureDir(destinationPath)
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(temporaryPath, content)
    renameSync(temporaryPath, destinationPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function resolveManifestPath(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null
  const absolutePath = resolve(root, relativePath)
  const normalizedRelative = relative(root, absolutePath)
  if (
    normalizedRelative === '' ||
    normalizedRelative === '..' ||
    normalizedRelative.startsWith(`..${sep}`)
  ) {
    return null
  }
  return absolutePath
}

function normalizeManifestRelativePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function readHarnessManifest(manifestPath: string): HarnessManifest | null {
  if (!existsSync(manifestPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<HarnessManifest>
    if (
      typeof parsed.version !== 'number' ||
      typeof parsed.generator !== 'string' ||
      !Array.isArray(parsed.files)
    ) {
      return null
    }
    const files: HarnessManifestFile[] = []
    for (const entry of parsed.files) {
      if (
        !entry ||
        typeof entry.path !== 'string' ||
        typeof entry.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        typeof entry.source !== 'string' ||
        typeof entry.userEditable !== 'boolean'
      ) {
        return null
      }
      files.push({ ...entry, path: normalizeManifestRelativePath(entry.path) })
    }
    return { version: parsed.version, generator: parsed.generator, files }
  } catch {
    return null
  }
}

function targetPathsForTree(sourceRoot: string, destinationRoot: string): string[] {
  return listFiles(sourceRoot).map((sourcePath) => join(destinationRoot, relative(sourceRoot, sourcePath)))
}

function finalizeHarnessManifest(config: AgenticConfig, selectedTools: string[]): void {
  const { targetDir } = config
  const srcDir = join(AGENTIC_DIR, 'shared')
  const selectedModules = selectModuleFactSheets(targetDir, join(GUIDES_DIR, 'modules'))
  const paths = new Set<string>([
    join(targetDir, 'AGENTS.md'),
    ...targetPathsForTree(join(srcDir, 'ai'), join(targetDir, '.ai')),
    ...targetPathsForTree(join(srcDir, 'scripts'), join(targetDir, 'scripts')),
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
    for (const file of listFiles(join(AGENTIC_DIR, 'cursor'))) {
      const rel = relative(join(AGENTIC_DIR, 'cursor'), file)
      paths.add(join(targetDir, '.cursor', rel))
    }
  }
  const manifestPath = join(targetDir, '.ai', 'harness', 'manifest.json')
  const externalSkills = externalSkillNames(targetDir)
  paths.delete(manifestPath)
  const files = [...paths]
    .filter((path) => existsSync(path))
    .sort((left, right) => left.localeCompare(right))
    .map((path) => {
      const relativePath = normalizeManifestRelativePath(relative(targetDir, path))
      const skillName = relativePath.match(/^\.ai\/skills\/([^/]+)\//)?.[1]
      return {
        path: relativePath,
        sha256: hashFile(path),
        source: skillName ? (externalSkills.has(skillName) ? 'external-override' : 'local-skill') : 'generated',
        userEditable: relativePath === 'AGENTS.md' || relativePath === '.ai/agentic.config.json' || relativePath === '.ai/lessons.md',
      }
    })
  atomicWriteFile(
    manifestPath,
    `${JSON.stringify({ version: 1, generator: harnessGeneratorId(), files }, null, 2)}\n`,
  )
}

/**
 * Publish a fully generated harness candidate using the previous ownership
 * manifest as the only source of ownership. Modified owned files and exact-path
 * collisions with unknown files stay untouched; their candidate is written next
 * to them as `<path>.incoming` for explicit review.
 */
export function applyHarnessUpdate(targetDir: string, stagingDir: string): string[] {
  const targetManifestPath = join(targetDir, '.ai', 'harness', 'manifest.json')
  const stagingManifestPath = join(stagingDir, '.ai', 'harness', 'manifest.json')
  const candidateManifest = readHarnessManifest(stagingManifestPath)
  if (!candidateManifest) {
    throw new Error('Generated harness candidate has a missing or invalid ownership manifest.')
  }

  const previousManifest = readHarnessManifest(targetManifestPath)
  const previousFiles = new Map(previousManifest?.files.map((entry) => [entry.path, entry]) ?? [])
  const candidates: Array<{
    entry: HarnessManifestFile
    sourcePath: string
    destinationPath: string
  }> = []

  // Validate the complete candidate before writing anything into the app.
  for (const entry of candidateManifest.files) {
    const sourcePath = resolveManifestPath(stagingDir, entry.path)
    const destinationPath = resolveManifestPath(targetDir, entry.path)
    if (!sourcePath || !destinationPath || !existsSync(sourcePath) || hashFile(sourcePath) !== entry.sha256) {
      throw new Error(`Generated harness candidate is invalid for ${JSON.stringify(entry.path)}.`)
    }
    candidates.push({ entry, sourcePath, destinationPath })
  }

  const conflicts: string[] = []
  for (const { entry, sourcePath, destinationPath } of candidates) {
    if (!existsSync(destinationPath)) {
      atomicCopyFile(sourcePath, destinationPath)
      continue
    }

    const currentHash = hashFile(destinationPath)
    const previousEntry = previousFiles.get(entry.path)
    if (currentHash === entry.sha256 || (previousEntry && currentHash === previousEntry.sha256)) {
      atomicCopyFile(sourcePath, destinationPath)
      continue
    }

    atomicCopyFile(sourcePath, `${destinationPath}.incoming`)
    conflicts.push(entry.path)
  }

  // The candidate hashes deliberately remain in the manifest for conflicts. If
  // the user accepts an .incoming file, a later update can recognize it as an
  // unmodified owned file. Until then the hash mismatch keeps preserving it.
  atomicCopyFile(stagingManifestPath, targetManifestPath)
  return conflicts
}

// ─── Generators ──────────────────────────────────────────────────────────

function generateShared(config: AgenticConfig): void {
  const { targetDir } = config
  const srcDir = join(AGENTIC_DIR, 'shared')

  // Resolve which per-module fact-sheets this app gets (enabled ∩ bundled allowlist).
  const selectedModules = selectModuleFactSheets(targetDir, join(GUIDES_DIR, 'modules'))
  const moduleGuideLabels = readModuleGuideLabels(GUIDES_DIR)

  // One recursive mapping mirrors create-app's shared emitter.
  writeTemplate(srcDir, 'AGENTS.md.template', join(targetDir, 'AGENTS.md'), config)
  copyTree(join(srcDir, 'ai'), join(targetDir, '.ai'), config)
  copyTree(join(srcDir, 'scripts'), join(targetDir, 'scripts'), config)

  // Package & conceptual guides are copied wholesale (framework-wide). Per-module
  // fact-sheets (.ai/guides/modules/<module>.md) are filtered to the app's enabled
  // module set; the combined module-facts.json sidecar is copied as-is.
  if (existsSync(GUIDES_DIR)) {
    const guidesDestDir = join(targetDir, '.ai', 'guides')
    for (const file of readdirSync(GUIDES_DIR)) {
      if (!file.endsWith('.md')) continue
      const srcPath = join(GUIDES_DIR, file)
      const destPath = join(guidesDestDir, file)
      ensureDir(destPath)
      copyFileSync(srcPath, destPath)
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

function generateClaudeCode(config: AgenticConfig): void {
  const { targetDir } = config
  const srcDir = join(AGENTIC_DIR, 'claude-code')

  writeTemplate(srcDir, 'CLAUDE.md.template', join(targetDir, 'CLAUDE.md'), config)
  copyFile(srcDir, 'settings.json', join(targetDir, '.claude', 'settings.json'))
  copyFile(srcDir, 'hooks/entity-migration-check.ts', join(targetDir, '.claude', 'hooks', 'entity-migration-check.ts'))
  copyFile(srcDir, 'mcp.json.example', join(targetDir, '.mcp.json.example'))

  // The installer exclusively owns Claude's per-skill compatibility links.
}

function generateCodex(config: AgenticConfig): void {
  const { targetDir } = config
  const srcDir = join(AGENTIC_DIR, 'codex')

  const agentsPath = join(targetDir, 'AGENTS.md')
  if (existsSync(agentsPath)) {
    const enforcement = readFileSync(join(srcDir, 'enforcement-rules.md'), 'utf-8')
    let agents = readFileSync(agentsPath, 'utf-8')
    const MARKER_START = '<!-- CODEX_ENFORCEMENT_RULES_START -->'
    const MARKER_END = '<!-- CODEX_ENFORCEMENT_RULES_END -->'

    if (agents.includes(MARKER_START)) {
      const startIdx = agents.indexOf(MARKER_START)
      const endIdx = agents.indexOf(MARKER_END)
      if (endIdx !== -1) {
        agents = agents.slice(0, startIdx) + enforcement + agents.slice(endIdx + MARKER_END.length)
      }
    } else {
      const firstNewline = agents.indexOf('\n')
      if (firstNewline !== -1) {
        agents = agents.slice(0, firstNewline + 1) + '\n' + enforcement + '\n' + agents.slice(firstNewline + 1)
      } else {
        agents = agents + '\n\n' + enforcement
      }
    }
    writeFileSync(agentsPath, agents)
  }

  copyFile(srcDir, 'mcp.json.example', join(targetDir, '.codex', 'mcp.json.example'))

  // No .codex/skills directory: Codex reads the canonical .agents/skills/,
  // which scripts/install-skills.sh populates.
}

function generateCursor(config: AgenticConfig): void {
  const { targetDir } = config
  const srcDir = join(AGENTIC_DIR, 'cursor')

  writeTemplate(srcDir, 'rules/open-mercato.mdc', join(targetDir, '.cursor', 'rules', 'open-mercato.mdc'), config)
  copyFile(srcDir, 'rules/entity-guard.mdc', join(targetDir, '.cursor', 'rules', 'entity-guard.mdc'))
  copyFile(srcDir, 'rules/generated-guard.mdc', join(targetDir, '.cursor', 'rules', 'generated-guard.mdc'))
  copyFile(srcDir, 'hooks.json', join(targetDir, '.cursor', 'hooks.json'))
  copyFile(srcDir, 'hooks/entity-migration-check.mjs', join(targetDir, '.cursor', 'hooks', 'entity-migration-check.mjs'))
  copyFile(srcDir, 'mcp.json.example', join(targetDir, '.cursor', 'mcp.json.example'))

  // No .cursor/skills directory: Cursor reads the canonical .agents/skills/,
  // which scripts/install-skills.sh populates.
}

// ─── Wizard ──────────────────────────────────────────────────────────────

const TOOLS = [
  { key: '1', label: 'Claude Code     (Anthropic)', id: 'claude-code' },
  { key: '2', label: 'Codex           (OpenAI)', id: 'codex' },
  { key: '3', label: 'Cursor          (Anysphere)', id: 'cursor' },
  { key: '4', label: 'Multiple tools  (select individually)', id: 'multiple' },
  { key: '5', label: 'Skip — set up manually later', id: 'skip' },
] as const

const SELECTABLE = TOOLS.filter((t) => t.id !== 'multiple' && t.id !== 'skip')

async function promptSelection(ask: AskFn): Promise<string[]> {
  console.log('')
  console.log('🤖  Agentic workflow setup')
  console.log('')
  console.log('   Which AI coding tool will you use with this project?')
  console.log('')
  for (const tool of TOOLS) {
    console.log(`   ${tool.key}. ${tool.label}`)
  }
  console.log('')

  const answer = (await ask('   Enter number(s) separated by comma [1]: ')).trim() || '1'

  if (answer === '5') return ['skip']

  if (answer === '4') {
    const selected: string[] = []
    for (const tool of SELECTABLE) {
      const yn = await ask(`   Include ${tool.label}? [y/N]: `)
      if (yn.toLowerCase() === 'y' || yn.toLowerCase() === 'yes') {
        selected.push(tool.id)
      }
    }
    return selected.length > 0 ? selected : ['skip']
  }

  const keys = answer.split(',').map((s) => s.trim())
  const ids: string[] = []
  for (const key of keys) {
    const tool = TOOLS.find((t) => t.key === key)
    if (tool && tool.id !== 'multiple' && tool.id !== 'skip') {
      ids.push(tool.id)
    }
  }
  return ids.length > 0 ? ids : ['skip']
}

export async function runAgenticSetup(
  targetDir: string,
  ask: AskFn,
  options?: AgenticSetupOptions,
): Promise<void> {
  let selectedIds: string[]

  if (options?.tool) {
    selectedIds = options.tool.split(',').map((t) => t.trim())
  } else {
    selectedIds = await promptSelection(ask)
  }

  if (selectedIds.includes('skip')) {
    console.log('')
    console.log('   Skipped agentic setup.')
    console.log('')
    return
  }

  const config: AgenticConfig = {
    projectName: basename(targetDir),
    targetDir,
  }

  if (options?.updateHarness && !options.force) {
    const stagingDir = mkdtempSync(join(tmpdir(), 'open-mercato-harness-'))
    try {
      const modulesSourcePath = join(targetDir, 'src', 'modules.ts')
      const modulesCandidatePath = join(stagingDir, 'src', 'modules.ts')
      ensureDir(modulesCandidatePath)
      copyFileSync(modulesSourcePath, modulesCandidatePath)

      const stagingConfig: AgenticConfig = {
        projectName: config.projectName,
        targetDir: stagingDir,
      }
      generateHarness(stagingConfig, selectedIds)
      const conflicts = applyHarnessUpdate(targetDir, stagingDir)
      if (conflicts.length > 0) {
        console.warn('')
        console.warn('   ⚠ Preserved locally modified harness files:')
        for (const path of conflicts) console.warn(`   • ${path} (candidate: ${path}.incoming)`)
      }
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  } else {
    generateHarness(config, selectedIds)
  }

  installSkills(targetDir)

  console.log('')
  console.log('   Agentic setup complete:')
  if (selectedIds.includes('claude-code')) {
    console.log('   ✓ Claude Code — CLAUDE.md, .claude/hooks/, .mcp.json.example')
  }
  if (selectedIds.includes('codex')) {
    console.log('   ✓ Codex — AGENTS.md enforcement rules, .codex/mcp.json.example')
  }
  if (selectedIds.includes('cursor')) {
    console.log('   ✓ Cursor — .cursor/rules/, .cursor/hooks/, .cursor/mcp.json.example')
  }
  console.log('')
  console.log('   .ai/agentic.config.json ships preconfigured (GitHub tracker, labels off);')
  console.log('   run /om-setup-agent-pipeline in your agent CLI to tailor labels, QA gate,')
  console.log('   tracker, or validation commands. Re-run `yarn install-skills` anytime to')
  console.log('   refresh the external open-mercato/skills subset.')
  console.log('')
}

function generateHarness(config: AgenticConfig, selectedIds: string[]): void {
  generateShared(config)
  if (selectedIds.includes('claude-code')) generateClaudeCode(config)
  if (selectedIds.includes('codex')) generateCodex(config)
  if (selectedIds.includes('cursor')) generateCursor(config)

  persistAgentSelection(config.targetDir, selectedIds)
  finalizeHarnessManifest(config, selectedIds)
}

/**
 * Persist the agent selection so later `yarn install-skills` runs keep honoring
 * it: agents the user did not pick go into `agents.ignore` in tiers.json and
 * never get a skills directory of their own.
 */
function persistAgentSelection(targetDir: string, selectedIds: string[]): void {
  const manifestPath = join(targetDir, '.ai', 'skills', 'tiers.json')
  if (!existsSync(manifestPath)) return
  const ignore = SELECTABLE.map((tool) => tool.id).filter((id) => !selectedIds.includes(id))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
  if (ignore.length > 0) {
    manifest.agents = { ignore }
  } else {
    delete manifest.agents
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function installSkills(targetDir: string): void {
  const installScript = join(targetDir, 'scripts', 'install-skills.mjs')
  if (!existsSync(installScript)) return
  console.log('')
  console.log('   Installing agent skills (local tiers + external open-mercato/skills subset)...')
  const result = spawnSync(process.execPath, [installScript], { cwd: targetDir, stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    console.log('   ⚠ Skill installation did not complete; run `yarn install-skills` inside the app when online.')
  }
}
