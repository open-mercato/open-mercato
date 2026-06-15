import { basename } from 'node:path'
import { generateShared, loadSkillManifest } from './tools/shared.js'
import { generateClaudeCode } from './tools/claude-code.js'
import { generateCodex } from './tools/codex.js'
import { generateCursor } from './tools/cursor.js'
import { CORE_PACKAGE } from './tools/skill-packages.js'

export type AskFn = (question: string) => Promise<string>

export interface AgenticSetupOptions {
  tool?: string
  force?: boolean
  /** Pre-resolved skill packages (from --skill-packages); skips the package prompt. */
  skillPackages?: string[]
}

export interface AgenticConfig {
  projectName: string
  targetDir: string
  /** Selected skill packages. When empty/undefined, generateShared falls back to the manifest default. */
  skillPackages?: string[]
}

const TOOLS = [
  { key: '1', label: 'Claude Code     (Anthropic)', id: 'claude-code' },
  { key: '2', label: 'Codex           (OpenAI)', id: 'codex' },
  { key: '3', label: 'Cursor          (Anysphere)', id: 'cursor' },
  { key: '4', label: 'Multiple tools  (select individually)', id: 'multiple' },
  { key: '5', label: 'Skip — set up manually later', id: 'skip' },
] as const

const SELECTABLE_TOOLS = TOOLS.filter((t) => t.id !== 'multiple' && t.id !== 'skip')

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

  // Handle skip
  if (answer === '5') return ['skip']

  // Handle "multiple" — ask for each tool individually
  if (answer === '4') {
    const selected: string[] = []
    for (const tool of SELECTABLE_TOOLS) {
      const yn = await ask(`   Include ${tool.label}? [y/N]: `)
      if (yn.toLowerCase() === 'y' || yn.toLowerCase() === 'yes') {
        selected.push(tool.id)
      }
    }
    return selected.length > 0 ? selected : ['skip']
  }

  // Parse comma-separated numbers
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

// Ask which skill packages to install. Shown for every tool (skills live under
// .ai/skills/ regardless of tool). `core` is always installed and not offered.
// Empty input selects the manifest's recommended default set.
async function promptSkillPackages(ask: AskFn): Promise<string[]> {
  const manifest = loadSkillManifest()
  const selectable = Object.keys(manifest.packages).filter((name) => name !== CORE_PACKAGE)

  console.log('')
  console.log('   Which skill packages do you want to install?')
  console.log('')
  const coreDescription = manifest.packages[CORE_PACKAGE]?.description ?? 'always installed'
  console.log(`   • core — ${coreDescription} (always on)`)
  selectable.forEach((name, index) => {
    const suffix = manifest.default.includes(name) ? ' [recommended]' : ''
    console.log(`   ${index + 1}. ${name} — ${manifest.packages[name].description}${suffix}`)
  })
  console.log('')

  const answer = (await ask('   Enter number(s) separated by comma, or Enter for the recommended set: ')).trim()
  if (!answer) return manifest.default

  const chosen = answer
    .split(',')
    .map((token) => selectable[Number(token.trim()) - 1])
    .filter((name): name is string => Boolean(name))
  return chosen.length > 0 ? chosen : manifest.default
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
    console.log('   Skipped agentic setup. Run `yarn mercato agentic:init` later to configure.')
    console.log('')
    return
  }

  const skillPackages =
    options?.skillPackages && options.skillPackages.length > 0
      ? options.skillPackages
      : await promptSkillPackages(ask)

  const config: AgenticConfig = {
    projectName: basename(targetDir),
    targetDir,
    skillPackages,
  }

  // Order matters — codex patches AGENTS.md created by shared
  generateShared(config)
  if (selectedIds.includes('claude-code')) generateClaudeCode(config)
  if (selectedIds.includes('codex')) generateCodex(config)
  if (selectedIds.includes('cursor')) generateCursor(config)

  printSummary(selectedIds, skillPackages)
}

function printSummary(selectedIds: string[], skillPackages: string[]): void {
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

  console.log(`   ✓ Skill packages — core, ${skillPackages.filter((name) => name !== CORE_PACKAGE).join(', ') || '(core only)'}`)

  if (selectedIds.includes('claude-code') && skillPackages.includes('automation')) {
    console.log('')
    console.log('   ⚡ Autonomous skills shipped under .ai/skills/:')
    console.log('      /om-auto-create-pr  <task>    — delegate a whole task end-to-end as a PR')
    console.log('      /om-auto-continue-pr <PR#>    — resume an in-progress agent PR')
    console.log('      /om-auto-review-pr   <PR#>    — automated code review (optional autofix)')
    console.log('      /om-auto-fix-github  <issue#> — fix a GitHub issue and open a PR')
    console.log('      /om-prepare-issue    <idea>   — spec out deferred work + open a tracking issue (no build)')
    console.log('      /om-trim-unused-modules       — slim classic-mode defaults after adding your own module')
    console.log('      See .ai/skills/om-auto-create-pr/STANDALONE.md for portability notes')
    console.log('      (base-branch discovery, opt-in pipeline labels, script probing).')
  }

  if (selectedIds.includes('claude-code') && skillPackages.includes('creative')) {
    console.log('')
    console.log('   🎨 Creative collaboration skills shipped under .ai/skills/:')
    console.log('      /om-proposal   — capture/refine a pre-spec idea collaboratively in .ai/proposals/')
    console.log('      /om-brainstorm — facilitate ideation (party mode, Socratic, 5-whys, yes-and)')
  }

  console.log('')
}
