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

const MODULE_GUIDE_LABELS: Record<string, string> = {
  customers: 'Build CRUD modules — reference patterns, commands, custom fields, search',
  workflows: 'Use workflow automation, triggers, user tasks, signals',
  catalog: 'Use product catalog, pricing engine, variants, offers',
  sales: 'Use sales orders, quotes, invoices, shipments, payments',
  auth: 'Use staff authentication, RBAC, roles, feature guards',
  currencies: 'Use multi-currency, exchange rates, dual recording',
  integrations: 'Build integration providers, credentials, health checks',
  data_sync: 'Build data sync adapters, import/export connectors',
  customer_accounts: 'Use customer portal auth, customer RBAC, portal pages',
}

function renderModuleGuidesBlock(selected: string[]): string {
  if (selected.length === 0) return '_No module fact-sheets are bundled for this app._'
  const rows = selected.map((moduleId) => {
    const label = MODULE_GUIDE_LABELS[moduleId] ?? `Use the ${moduleId} module`
    return `| ${label} | \`.ai/guides/modules/${moduleId}.md\` |`
  })
  return ['| Task | Load |', '|---|---|', ...rows].join('\n')
}

// Regenerate the marker-delimited Module-Specific Guides block in the written
// AGENTS.md from the selected module set. Replaces strictly between the markers so
// surrounding prose is untouched and repeat runs are idempotent.
export function injectModuleGuides(agentsMdPath: string, selected: string[]): void {
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
  const next = `${before}\n${renderModuleGuidesBlock(selected)}\n${after}`
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

export function generateShared(config: AgenticConfig): void {
  const { targetDir } = config

  // Resolve which per-module fact-sheets this app gets (enabled ∩ bundled allowlist).
  const selectedModules = selectModuleFactSheets(targetDir, join(GUIDES_DIR, 'modules'))

  // AGENTS.md (enhanced version replaces the minimal template one)
  writeTemplate('AGENTS.md.template', join(targetDir, 'AGENTS.md'), config)
  injectModuleGuides(join(targetDir, 'AGENTS.md'), selectedModules)

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
  if (existsSync(join(AGENTIC_DIR, 'ai', 'skills', 'om-integration-builder', 'STANDALONE.md'))) {
    copyFile(
      'ai/skills/om-integration-builder/STANDALONE.md',
      join(targetDir, '.ai', 'skills', 'om-integration-builder', 'STANDALONE.md'),
    )
  }

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
