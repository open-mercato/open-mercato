import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgenticConfig } from '../wizard.js'
import { resolveSkillSelection, type SkillPackageManifest } from './skill-packages.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In the bundled output (dist/index.js), __dirname is dist/.
// agentic/ is copied to dist/agentic/ by build.mjs.
const AGENTIC_DIR = join(__dirname, 'agentic', 'shared')
const GUIDES_DIR = join(__dirname, 'agentic', 'guides')
const SKILLS_REL = 'ai/skills'

function resolvePlaceholders(content: string, config: AgenticConfig): string {
  return content.replace(/\{\{PROJECT_NAME\}\}/g, config.projectName)
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

/** Read and minimally validate the standalone skill-package manifest (packages.json). */
export function loadSkillManifest(): SkillPackageManifest {
  const manifestPath = join(AGENTIC_DIR, SKILLS_REL, 'packages.json')
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SkillPackageManifest
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray(parsed.default) ||
    typeof parsed.packages !== 'object' ||
    parsed.packages === null
  ) {
    throw new Error(`Invalid skill package manifest at ${manifestPath}`)
  }
  return parsed
}

/**
 * Recursively copy a skill folder into the target app, applying {{PROJECT_NAME}}
 * substitution to every file. Files whose `<skill>/<relative>` path is gated
 * (owned by an unselected package) are skipped.
 */
function copySkillTree(skillName: string, config: AgenticConfig, gatedFiles: Set<string>): void {
  const srcRoot = join(AGENTIC_DIR, SKILLS_REL, skillName)
  if (!existsSync(srcRoot)) return

  const walk = (relDir: string): void => {
    const absDir = relDir ? join(srcRoot, relDir) : srcRoot
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(relPath)
        continue
      }
      if (gatedFiles.has(`${skillName}/${relPath}`)) continue
      const destPath = join(config.targetDir, '.ai', 'skills', skillName, ...relPath.split('/'))
      const content = readFileSync(join(absDir, entry.name), 'utf-8')
      ensureDir(destPath)
      writeFileSync(destPath, resolvePlaceholders(content, config))
    }
  }

  walk('')
}

export function generateShared(config: AgenticConfig): void {
  const { targetDir } = config

  // AGENTS.md (enhanced version replaces the minimal template one)
  writeTemplate('AGENTS.md.template', join(targetDir, 'AGENTS.md'), config)

  // .ai/ structure
  writeTemplate('ai/specs/README.md', join(targetDir, '.ai', 'specs', 'README.md'), config)
  copyFile('ai/specs/SPEC-000-template.md', join(targetDir, '.ai', 'specs', 'SPEC-000-template.md'))
  copyFile('ai/lessons.md', join(targetDir, '.ai', 'lessons.md'))

  // .ai/skills/ — manifest-driven (packages.json). `core` is always installed;
  // other packages ship only when selected. Package-owned `extraFiles` (e.g. the
  // om-spec-writing proposal-intake fragment owned by `creative`) are gated: skipped
  // during folder copy, then re-added only for the selected packages.
  const manifest = loadSkillManifest()
  const requested =
    config.skillPackages && config.skillPackages.length > 0 ? config.skillPackages : manifest.default
  const selection = resolveSkillSelection(requested, manifest)
  const gatedFiles = new Set(selection.gatedFiles)
  for (const skill of selection.skills) {
    copySkillTree(skill, config, gatedFiles)
  }
  for (const extra of selection.includeExtraFiles) {
    writeTemplate(`${SKILLS_REL}/${extra}`, join(targetDir, '.ai', 'skills', ...extra.split('/')), config)
  }

  // .ai/qa/tests/ — Playwright config for integration tests
  copyFile('ai/qa/tests/playwright.config.ts', join(targetDir, '.ai', 'qa', 'tests', 'playwright.config.ts'))

  // Package guides — auto-discovered from sibling packages during build
  if (existsSync(GUIDES_DIR)) {
    const guidesDestDir = join(targetDir, '.ai', 'guides')
    for (const file of readdirSync(GUIDES_DIR)) {
      if (file.endsWith('.md')) {
        const srcPath = join(GUIDES_DIR, file)
        const destPath = join(guidesDestDir, file)
        ensureDir(destPath)
        copyFileSync(srcPath, destPath)
      }
    }
  }
}
