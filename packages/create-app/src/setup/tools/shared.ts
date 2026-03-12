import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgenticConfig } from '../wizard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In the bundled output (dist/index.js), __dirname is dist/.
// agentic/ is copied to dist/agentic/ by build.mjs.
const AGENTIC_DIR = join(__dirname, 'agentic', 'shared')
const GUIDES_DIR = join(__dirname, 'agentic', 'guides')

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

  copyFile(
    'ai/skills/integration-builder/SKILL.md',
    join(targetDir, '.ai', 'skills', 'integration-builder', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/integration-builder/references/adapter-contracts.md',
    join(targetDir, '.ai', 'skills', 'integration-builder', 'references', 'adapter-contracts.md'),
  )

  // system-extension skill
  copyFile(
    'ai/skills/system-extension/SKILL.md',
    join(targetDir, '.ai', 'skills', 'system-extension', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/system-extension/references/extension-contracts.md',
    join(targetDir, '.ai', 'skills', 'system-extension', 'references', 'extension-contracts.md'),
  )

  // module-scaffold skill
  copyFile(
    'ai/skills/module-scaffold/SKILL.md',
    join(targetDir, '.ai', 'skills', 'module-scaffold', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/module-scaffold/references/naming-conventions.md',
    join(targetDir, '.ai', 'skills', 'module-scaffold', 'references', 'naming-conventions.md'),
  )

  // troubleshooter skill
  copyFile(
    'ai/skills/troubleshooter/SKILL.md',
    join(targetDir, '.ai', 'skills', 'troubleshooter', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/troubleshooter/references/diagnostic-commands.md',
    join(targetDir, '.ai', 'skills', 'troubleshooter', 'references', 'diagnostic-commands.md'),
  )

  // eject-and-customize skill
  copyFile(
    'ai/skills/eject-and-customize/SKILL.md',
    join(targetDir, '.ai', 'skills', 'eject-and-customize', 'SKILL.md'),
  )

  // data-model-design skill
  copyFile(
    'ai/skills/data-model-design/SKILL.md',
    join(targetDir, '.ai', 'skills', 'data-model-design', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/data-model-design/references/mikro-orm-cheatsheet.md',
    join(targetDir, '.ai', 'skills', 'data-model-design', 'references', 'mikro-orm-cheatsheet.md'),
  )

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
