/**
 * Agentic setup for the CLI `agentic:init` command.
 *
 * Source files live in packages/create-app/agentic/ and are copied
 * to packages/cli/dist/agentic/ during build (see build.mjs).
 * This module reads those files at runtime — no embedded string constants.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In the built output (dist/lib/agentic-setup.js), __dirname is dist/lib/.
// agentic/ is copied to dist/agentic/ by build.mjs.
const AGENTIC_DIR = join(__dirname, '..', 'agentic')

type AskFn = (question: string) => Promise<string>

interface AgenticSetupOptions {
  tool?: string
  force?: boolean
}

interface AgenticConfig {
  projectName: string
  targetDir: string
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

// ─── Generators ──────────────────────────────────────────────────────────

function generateShared(config: AgenticConfig): void {
  const { targetDir } = config
  const srcDir = join(AGENTIC_DIR, 'shared')

  // AGENTS.md
  writeTemplate(srcDir, 'AGENTS.md.template', join(targetDir, 'AGENTS.md'), config)

  // .ai/ structure
  writeTemplate(srcDir, 'ai/specs/README.md', join(targetDir, '.ai', 'specs', 'README.md'), config)
  copyFile(srcDir, 'ai/specs/SPEC-000-template.md', join(targetDir, '.ai', 'specs', 'SPEC-000-template.md'))
  copyFile(srcDir, 'ai/lessons.md', join(targetDir, '.ai', 'lessons.md'))

  // .ai/skills/
  writeTemplate(
    srcDir,
    'ai/skills/spec-writing/SKILL.md',
    join(targetDir, '.ai', 'skills', 'spec-writing', 'SKILL.md'),
    config,
  )
  copyFile(
    srcDir,
    'ai/skills/spec-writing/references/spec-template.md',
    join(targetDir, '.ai', 'skills', 'spec-writing', 'references', 'spec-template.md'),
  )
  copyFile(
    srcDir,
    'ai/skills/spec-writing/references/spec-checklist.md',
    join(targetDir, '.ai', 'skills', 'spec-writing', 'references', 'spec-checklist.md'),
  )
  copyFile(
    srcDir,
    'ai/skills/backend-ui-design/SKILL.md',
    join(targetDir, '.ai', 'skills', 'backend-ui-design', 'SKILL.md'),
  )
  copyFile(
    srcDir,
    'ai/skills/backend-ui-design/references/ui-components.md',
    join(targetDir, '.ai', 'skills', 'backend-ui-design', 'references', 'ui-components.md'),
  )
  copyFile(
    srcDir,
    'ai/skills/code-review/SKILL.md',
    join(targetDir, '.ai', 'skills', 'code-review', 'SKILL.md'),
  )
  copyFile(
    srcDir,
    'ai/skills/code-review/references/review-checklist.md',
    join(targetDir, '.ai', 'skills', 'code-review', 'references', 'review-checklist.md'),
  )
  copyFile(srcDir, 'ai/skills/integration-builder/SKILL.md', join(targetDir, '.ai', 'skills', 'integration-builder', 'SKILL.md'))
  copyFile(
    srcDir,
    'ai/skills/integration-builder/references/adapter-contracts.md',
    join(targetDir, '.ai', 'skills', 'integration-builder', 'references', 'adapter-contracts.md'),
  )
}

function generateClaudeCode(config: AgenticConfig): void {
  const { targetDir } = config
  const srcDir = join(AGENTIC_DIR, 'claude-code')

  writeTemplate(srcDir, 'CLAUDE.md.template', join(targetDir, 'CLAUDE.md'), config)
  copyFile(srcDir, 'settings.json', join(targetDir, '.claude', 'settings.json'))
  copyFile(srcDir, 'hooks/entity-migration-check.ts', join(targetDir, '.claude', 'hooks', 'entity-migration-check.ts'))
  copyFile(srcDir, 'mcp.json.example', join(targetDir, '.mcp.json.example'))

  // Symlink .claude/skills → ../.ai/skills
  ensureSkillsLink(join(targetDir, '.claude', 'skills'), join('..', '.ai', 'skills'))
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

  // Symlink .codex/skills → ../.ai/skills
  ensureSkillsLink(join(targetDir, '.codex', 'skills'), join('..', '.ai', 'skills'))
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

  // Symlink .cursor/skills → ../.ai/skills
  ensureSkillsLink(join(targetDir, '.cursor', 'skills'), join('..', '.ai', 'skills'))
}

function ensureSkillsLink(linkPath: string, target: string): void {
  ensureDir(linkPath)
  if (existsSync(linkPath) && !lstatSync(linkPath).isSymbolicLink()) {
    return
  }
  if (lstatSync(linkPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    unlinkSync(linkPath)
  }
  symlinkSync(target, linkPath)
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

  generateShared(config)
  if (selectedIds.includes('claude-code')) generateClaudeCode(config)
  if (selectedIds.includes('codex')) generateCodex(config)
  if (selectedIds.includes('cursor')) generateCursor(config)

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
}
