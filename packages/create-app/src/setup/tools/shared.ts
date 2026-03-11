import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgenticConfig } from '../wizard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In the bundled output (dist/index.js), __dirname is dist/.
// agentic/ is copied to dist/agentic/ by build.mjs.
const AGENTIC_DIR = join(__dirname, 'agentic', 'shared')

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

export function generateShared(config: AgenticConfig): void {
  const { targetDir } = config

  // AGENTS.md (enhanced version replaces the minimal template one)
  writeTemplate('AGENTS.md.template', join(targetDir, 'AGENTS.md'), config)

  // .ai/ structure
  writeTemplate('ai/specs/README.md', join(targetDir, '.ai', 'specs', 'README.md'), config)
  copyFile('ai/specs/SPEC-000-template.md', join(targetDir, '.ai', 'specs', 'SPEC-000-template.md'))
  copyFile('ai/lessons.md', join(targetDir, '.ai', 'lessons.md'))

  // .ai/skills/
  writeTemplate(
    'ai/skills/spec-writing/SKILL.md',
    join(targetDir, '.ai', 'skills', 'spec-writing', 'SKILL.md'),
    config,
  )
  copyFile(
    'ai/skills/spec-writing/references/spec-template.md',
    join(targetDir, '.ai', 'skills', 'spec-writing', 'references', 'spec-template.md'),
  )
  copyFile(
    'ai/skills/spec-writing/references/spec-checklist.md',
    join(targetDir, '.ai', 'skills', 'spec-writing', 'references', 'spec-checklist.md'),
  )

  copyFile(
    'ai/skills/backend-ui-design/SKILL.md',
    join(targetDir, '.ai', 'skills', 'backend-ui-design', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/backend-ui-design/references/ui-components.md',
    join(targetDir, '.ai', 'skills', 'backend-ui-design', 'references', 'ui-components.md'),
  )

  copyFile(
    'ai/skills/code-review/SKILL.md',
    join(targetDir, '.ai', 'skills', 'code-review', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/code-review/references/review-checklist.md',
    join(targetDir, '.ai', 'skills', 'code-review', 'references', 'review-checklist.md'),
  )
}
