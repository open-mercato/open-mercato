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
    'ai/skills/om-spec-writing/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-spec-writing', 'SKILL.md'),
    config,
  )
  copyFile(
    'ai/skills/om-spec-writing/references/spec-template.md',
    join(targetDir, '.ai', 'skills', 'om-spec-writing', 'references', 'spec-template.md'),
  )
  copyFile(
    'ai/skills/om-spec-writing/references/spec-checklist.md',
    join(targetDir, '.ai', 'skills', 'om-spec-writing', 'references', 'spec-checklist.md'),
  )

  copyFile(
    'ai/skills/om-backend-ui-design/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-backend-ui-design', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/om-backend-ui-design/references/ui-components.md',
    join(targetDir, '.ai', 'skills', 'om-backend-ui-design', 'references', 'ui-components.md'),
  )

  copyFile(
    'ai/skills/om-code-review/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-code-review', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/om-code-review/references/review-checklist.md',
    join(targetDir, '.ai', 'skills', 'om-code-review', 'references', 'review-checklist.md'),
  )

  copyFile(
    'ai/skills/om-integration-builder/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-integration-builder', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/om-integration-builder/references/adapter-contracts.md',
    join(targetDir, '.ai', 'skills', 'om-integration-builder', 'references', 'adapter-contracts.md'),
  )

  // system-extension skill
  copyFile(
    'ai/skills/om-system-extension/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-system-extension', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/om-system-extension/references/extension-contracts.md',
    join(targetDir, '.ai', 'skills', 'om-system-extension', 'references', 'extension-contracts.md'),
  )

  // module-scaffold skill
  copyFile(
    'ai/skills/om-module-scaffold/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-module-scaffold', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/om-module-scaffold/references/naming-conventions.md',
    join(targetDir, '.ai', 'skills', 'om-module-scaffold', 'references', 'naming-conventions.md'),
  )
  copyFile(
    'ai/skills/om-module-scaffold/references/navigation-patterns.md',
    join(targetDir, '.ai', 'skills', 'om-module-scaffold', 'references', 'navigation-patterns.md'),
  )

  // troubleshooter skill
  copyFile(
    'ai/skills/om-troubleshooter/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-troubleshooter', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/om-troubleshooter/references/diagnostic-commands.md',
    join(targetDir, '.ai', 'skills', 'om-troubleshooter', 'references', 'diagnostic-commands.md'),
  )

  // eject-and-customize skill
  copyFile(
    'ai/skills/om-eject-and-customize/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-eject-and-customize', 'SKILL.md'),
  )

  // data-model-design skill
  copyFile(
    'ai/skills/om-data-model-design/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-data-model-design', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/om-data-model-design/references/mikro-orm-cheatsheet.md',
    join(targetDir, '.ai', 'skills', 'om-data-model-design', 'references', 'mikro-orm-cheatsheet.md'),
  )

  // implement-spec skill
  copyFile(
    'ai/skills/om-implement-spec/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-implement-spec', 'SKILL.md'),
  )

  // integration-tests skill
  copyFile(
    'ai/skills/om-integration-tests/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-integration-tests', 'SKILL.md'),
  )

  // help / workflow navigator skill
  copyFile(
    'ai/skills/om-help/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-help', 'SKILL.md'),
  )
  copyFile(
    'ai/skills/om-help/references/skills-catalog.md',
    join(targetDir, '.ai', 'skills', 'om-help', 'references', 'skills-catalog.md'),
  )
  copyFile(
    'ai/skills/om-help/references/workflow-sequences.md',
    join(targetDir, '.ai', 'skills', 'om-help', 'references', 'workflow-sequences.md'),
  )

  // 0.4.10 -> 0.5.0 upgrade companion skill
  copyFile(
    'ai/skills/om-auto-upgrade-0.4.10-to-0.5.0/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-auto-upgrade-0.4.10-to-0.5.0', 'SKILL.md'),
  )

  // Agent automation / auto-* skills. Some skills also ship with a
  // STANDALONE.md portability override that adjusts the workflow for use in
  // standalone apps (default-branch discovery, opt-in pipeline labels,
  // probe-before-run validation gate, src/modules/... file layout).
  for (const autoSkill of [
    'om-auto-create-pr',
    'om-auto-continue-pr',
    'om-auto-create-pr-loop',
    'om-auto-continue-pr-loop',
    'om-auto-review-pr',
    'om-auto-fix-github',
    'om-prepare-issue',
  ]) {
    if (!existsSync(join(AGENTIC_DIR, 'ai', 'skills', autoSkill, 'SKILL.md'))) {
      continue
    }
    copyFile(
      `ai/skills/${autoSkill}/SKILL.md`,
      join(targetDir, '.ai', 'skills', autoSkill, 'SKILL.md'),
    )
    if (existsSync(join(AGENTIC_DIR, 'ai', 'skills', autoSkill, 'STANDALONE.md'))) {
      copyFile(
        `ai/skills/${autoSkill}/STANDALONE.md`,
        join(targetDir, '.ai', 'skills', autoSkill, 'STANDALONE.md'),
      )
    }
  }

  // Classic-mode slimdown skill — offered after the user adds a new module
  // so unused built-in modules can be disabled from src/modules.ts.
  copyFile(
    'ai/skills/om-trim-unused-modules/SKILL.md',
    join(targetDir, '.ai', 'skills', 'om-trim-unused-modules', 'SKILL.md'),
  )

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
