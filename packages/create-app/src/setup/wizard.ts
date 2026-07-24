import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { generateShared } from './tools/shared.js'
import { generateClaudeCode } from './tools/claude-code.js'
import { generateCodex } from './tools/codex.js'
import { generateCursor } from './tools/cursor.js'

export type AskFn = (question: string) => Promise<string>

export interface AgenticSetupOptions {
  tool?: string
  force?: boolean
}

export interface AgenticConfig {
  projectName: string
  targetDir: string
}

const TOOLS = [
  { key: '1', label: 'Claude Code     (Anthropic)', id: 'claude-code' },
  { key: '2', label: 'Codex           (OpenAI)', id: 'codex' },
  { key: '3', label: 'Cursor          (Anysphere)', id: 'cursor' },
  { key: '4', label: 'Multiple tools  (select individually)', id: 'multiple' },
  { key: '5', label: 'Skip — set up manually later', id: 'skip' },
] as const

const SELECTABLE_TOOLS = TOOLS.filter((t) => t.id !== 'multiple' && t.id !== 'skip')

/** Concrete agent tool ids accepted by the `--agents` CLI flag. */
export const AGENT_TOOL_IDS: readonly string[] = SELECTABLE_TOOLS.map((t) => t.id)

export interface ParsedAgentsArg {
  /** True when the value asked to skip agentic setup (`none`/`skip`). */
  skip: boolean
  /** Concrete tool ids to set up (empty when `skip`). */
  tools: string[]
}

/**
 * Parse the `--agents` value into a validated selection. Accepts a
 * comma-separated list of tool ids plus the aliases `all` and `none`/`skip`.
 * Throws (with the valid set) on unknown ids or contradictory combinations so
 * the CLI fails fast instead of doing a silent half-setup.
 */
export function parseAgentsValue(raw: string): ParsedAgentsArg {
  const validList = `${AGENT_TOOL_IDS.join(', ')}, all, none`
  const tokens = raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (tokens.length === 0) {
    throw new Error(`--agents requires at least one value (e.g. ${validList})`)
  }

  const hasSkip = tokens.some((t) => t === 'none' || t === 'skip')
  const hasAll = tokens.some((t) => t === 'all')
  const toolTokens = tokens.filter((t) => t !== 'none' && t !== 'skip' && t !== 'all')

  const unknown = toolTokens.filter((t) => !AGENT_TOOL_IDS.includes(t))
  if (unknown.length > 0) {
    throw new Error(`Unknown agent ${unknown.map((u) => `"${u}"`).join(', ')}. Valid: ${validList}`)
  }

  if (hasSkip) {
    if (hasAll || toolTokens.length > 0) {
      throw new Error('--agents none cannot be combined with other agents')
    }
    return { skip: true, tools: [] }
  }
  if (hasAll) {
    if (toolTokens.length > 0) {
      throw new Error('--agents all cannot be combined with individual agents')
    }
    return { skip: false, tools: [...AGENT_TOOL_IDS] }
  }
  return { skip: false, tools: [...new Set(toolTokens)] }
}

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

export async function runAgenticSetup(
  targetDir: string,
  ask: AskFn,
  options?: AgenticSetupOptions,
): Promise<boolean> {
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
    return false
  }

  const config: AgenticConfig = {
    projectName: basename(targetDir),
    targetDir,
  }

  // Order matters — codex patches AGENTS.md created by shared
  generateShared(config)
  if (selectedIds.includes('claude-code')) generateClaudeCode(config)
  if (selectedIds.includes('codex')) generateCodex(config)
  if (selectedIds.includes('cursor')) generateCursor(config)

  persistAgentSelection(targetDir, selectedIds)
  installSkills(targetDir)
  printSummary(selectedIds)
  return true
}

/**
 * Persist the agent selection so later `yarn install-skills` runs keep honoring
 * it: agents the user did not pick go into `agents.ignore` in tiers.json and
 * never get a skills directory of their own.
 */
function persistAgentSelection(targetDir: string, selectedIds: string[]): void {
  const manifestPath = join(targetDir, '.ai', 'skills', 'tiers.json')
  if (!existsSync(manifestPath)) return
  const ignore = AGENT_TOOL_IDS.filter((id) => !selectedIds.includes(id))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
  if (ignore.length > 0) {
    manifest.agents = { ignore }
  } else {
    delete manifest.agents
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function installSkills(targetDir: string): void {
  const installScript = join(targetDir, 'scripts', 'install-skills.sh')
  if (!existsSync(installScript)) return
  console.log('')
  console.log('   Installing agent skills (local tiers + external open-mercato/skills subset)...')
  const result = spawnSync('sh', [installScript], { cwd: targetDir, stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    console.log('   ⚠ Skill installation did not complete; run `yarn install-skills` inside the app when online.')
  }
}

function printSummary(selectedIds: string[]): void {
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

  if (selectedIds.includes('claude-code')) {
    console.log('')
    console.log('   ⚡ Autonomous skills (repo-local overrides under .ai/skills/,')
    console.log('      external workflow bodies installed above):')
    console.log('      /om-auto-create-pr  <task>    — delegate a whole task end-to-end as a PR')
    console.log('      /om-auto-continue-pr <PR#>    — resume an in-progress agent PR')
    console.log('      /om-auto-review-pr   <PR#>    — automated code review (optional autofix)')
    console.log('      /om-auto-fix-issue   <issue#> — fix a tracker issue and open a PR')
    console.log('      /om-prepare-issue    <idea>   — spec out deferred work + open a tracking issue (no build)')
    console.log('      /om-trim-unused-modules       — slim classic-mode defaults after adding your own module')
    console.log('      The external open-mercato/skills subset installs automatically')
    console.log('      (including chain steps like om-prepare-test-env and the autofix')
    console.log('      chain om-verify-in-repo → om-root-cause → om-fix → om-open-pr);')
    console.log('      re-run anytime with `yarn install-skills`. The local override')
    console.log('      SKILL.md files adjust them for your app (base-branch discovery,')
    console.log('      opt-in pipeline labels, script probing).')
  }

  console.log('')
}
