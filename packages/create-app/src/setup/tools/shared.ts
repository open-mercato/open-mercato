import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Project, SyntaxKind } from 'ts-morph'
import type { AgenticConfig } from '../wizard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In the bundled output (dist/index.js), __dirname is dist/.
// agentic/ is copied to dist/agentic/ by build.mjs.
const AGENTIC_DIR = join(__dirname, 'agentic', 'shared')
const GUIDES_DIR = join(__dirname, 'agentic', 'guides')

function resolvePlaceholders(content: string, config: AgenticConfig): string {
  return content.replace(/\{\{PROJECT_NAME\}\}/g, config.projectName)
}

export interface AgenticRuntimeConfig {
  projectName: string
  agentTools: string[]
  pr: { baseBranch: string }
}

// The single runtime environment file (`.ai/agentic.config.json`) that skills read
// for per-repo settings — chiefly `pr.baseBranch`. Kept additive/extensible: new
// install questions append keys without reshaping existing ones. This replaces the
// former per-skill STANDALONE.md override files.
export function buildAgenticConfig(config: AgenticConfig): AgenticRuntimeConfig {
  return {
    projectName: config.projectName,
    agentTools: [...config.agentTools],
    pr: { baseBranch: config.pr.baseBranch },
  }
}

function writeAgenticConfig(config: AgenticConfig): void {
  const destPath = join(config.targetDir, '.ai', 'agentic.config.json')
  ensureDir(destPath)
  writeFileSync(destPath, `${JSON.stringify(buildAgenticConfig(config), null, 2)}\n`)
}

// AST-parse the static `enabledModules` array literal in the scaffolded app's
// src/modules.ts and collect each entry's `id`. Only the static literal is read
// (conditional .push()/spread entries are intentionally not seen — see spec D6).
export function readEnabledModuleIds(modulesPath: string): string[] {
  if (!existsSync(modulesPath)) return []
  try {
    const project = new Project({ useInMemoryFileSystem: true })
    const sourceFile = project.createSourceFile('modules.ts', readFileSync(modulesPath, 'utf-8'))
    const declaration = sourceFile.getVariableDeclaration('enabledModules')
    const arrayLiteral = declaration?.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression)
    if (!arrayLiteral) return []
    const ids: string[] = []
    for (const element of arrayLiteral.getElements()) {
      const objectLiteral = element.asKind(SyntaxKind.ObjectLiteralExpression)
      if (!objectLiteral) continue
      const idProperty = objectLiteral.getProperty('id')?.asKind(SyntaxKind.PropertyAssignment)
      const idValue = idProperty?.getInitializerIfKind(SyntaxKind.StringLiteral)?.getLiteralValue()
      if (idValue) ids.push(idValue)
    }
    return ids
  } catch {
    return []
  }
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
  const enabled = new Set(readEnabledModuleIds(join(targetDir, 'src', 'modules.ts')))
  const selected = available.filter((moduleId) => enabled.has(moduleId))
  return selected.length > 0 ? selected : available
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

function copyFile(srcRelative: string, destPath: string): void {
  const srcPath = join(AGENTIC_DIR, srcRelative)
  ensureDir(destPath)
  copyFileSync(srcPath, destPath)
}

function isProbablyBinary(buffer: Buffer): boolean {
  const scanLength = Math.min(buffer.length, 8000)
  for (let index = 0; index < scanLength; index++) {
    if (buffer[index] === 0) return true
  }
  return false
}

// Recursively copy a skill directory into the scaffolded app, resolving
// {{PROJECT_NAME}} in every text file (binary files are copied verbatim) and
// skipping dotfiles/editor junk. Required now that a skill's file tree varies
// (workflow/, subagents/, references/) — a hard-coded per-file list can no longer
// describe it. Replaces the former writeTemplate/copyFile-per-skill logic.
export function copySkillTree(srcDir: string, destDir: string, config: AgenticConfig): void {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)
    if (entry.isDirectory()) {
      copySkillTree(srcPath, destPath, config)
      continue
    }
    if (!entry.isFile()) continue
    ensureDir(destPath)
    const buffer = readFileSync(srcPath)
    if (isProbablyBinary(buffer)) {
      copyFileSync(srcPath, destPath)
    } else {
      writeFileSync(destPath, resolvePlaceholders(buffer.toString('utf-8'), config))
    }
  }
}

export function generateShared(config: AgenticConfig): void {
  const { targetDir } = config

  // Environment file read by skills at runtime (single source of per-repo settings).
  writeAgenticConfig(config)

  // Resolve which per-module fact-sheets this app gets (enabled ∩ bundled allowlist).
  const selectedModules = selectModuleFactSheets(targetDir, join(GUIDES_DIR, 'modules'))
  const moduleGuideLabels = readModuleGuideLabels(GUIDES_DIR)

  // AGENTS.md (enhanced version replaces the minimal template one)
  writeTemplate('AGENTS.md.template', join(targetDir, 'AGENTS.md'), config)
  injectModuleGuides(join(targetDir, 'AGENTS.md'), selectedModules, moduleGuideLabels)

  // .ai/ structure
  writeTemplate('ai/specs/README.md', join(targetDir, '.ai', 'specs', 'README.md'), config)
  copyFile('ai/specs/SPEC-000-template.md', join(targetDir, '.ai', 'specs', 'SPEC-000-template.md'))
  copyFile('ai/lessons.md', join(targetDir, '.ai', 'lessons.md'))

  // .ai/skills/ — every skill directory is copied recursively so a skill's file
  // tree (SKILL.md + workflow/ + subagents/ + references/) ships whole, with
  // {{PROJECT_NAME}} resolved in each text file.
  const skillsSrcDir = join(AGENTIC_DIR, 'ai', 'skills')
  const skillsDestDir = join(targetDir, '.ai', 'skills')
  if (existsSync(skillsSrcDir)) {
    for (const entry of readdirSync(skillsSrcDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      copySkillTree(join(skillsSrcDir, entry.name), join(skillsDestDir, entry.name), config)
    }
  }

  // .ai/qa/tests/ — Playwright config for integration tests
  copyFile('ai/qa/tests/playwright.config.ts', join(targetDir, '.ai', 'qa', 'tests', 'playwright.config.ts'))

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

    const modulesSubdir = join(GUIDES_DIR, 'modules')
    for (const moduleId of selectedModules) {
      const destPath = join(guidesDestDir, 'modules', `${moduleId}.md`)
      ensureDir(destPath)
      copyFileSync(join(modulesSubdir, `${moduleId}.md`), destPath)
    }
  }
}
