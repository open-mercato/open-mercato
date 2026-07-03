import { basename } from 'node:path'
import { generateShared } from './tools/shared.js'
import { generateClaudeCode } from './tools/claude-code.js'
import { generateCodex } from './tools/codex.js'
import { generateCursor } from './tools/cursor.js'

export type AskFn = (question: string) => Promise<string>

export interface AgenticSetupOptions {
  tool?: string
  force?: boolean
  /** Base branch automated-PR skills should target. A literal branch or `auto`. */
  baseBranch?: string
}

export interface AgenticConfig {
  projectName: string
  targetDir: string
  /** Concrete agent tool ids set up for this app (empty when skipped). */
  agentTools: string[]
  pr: {
    /** Literal base branch for automated PRs, or `auto` to resolve at runtime. */
    baseBranch: string
  }
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

/**
 * Tools that ship the automated-PR skills (`om-auto-*`) and therefore consume
 * `pr.baseBranch` from `.ai/agentic.config.json`. Only when one of these is
 * selected does the interactive wizard ask which branch automated PRs target.
 */
export const PR_CAPABLE_TOOL_IDS: readonly string[] = ['claude-code']

/** Default base branch: resolve the repo's default branch at PR time. */
export const DEFAULT_PR_BASE = 'auto'

const PR_BASE_PROMPT_OPTIONS = [
  { number: '1', id: 'auto', label: 'Auto-detect (default)', hint: "resolve the repo's default branch at PR time" },
  { number: '2', id: 'main', label: 'main' },
  { number: '3', id: 'develop', label: 'develop' },
  { number: '4', id: 'other', label: 'Other…', hint: 'enter a branch name' },
] as const

/**
 * Normalize a base-branch answer (interactive number/keyword or CLI value) into
 * `auto` / `main` / `develop`, the `other` sentinel (interactive follow-up), or a
 * literal branch name. Empty input defaults to `auto`.
 */
export function normalizeBaseBranchAnswer(answer: string): string {
  const normalized = answer.trim().toLowerCase()
  if (!normalized) return DEFAULT_PR_BASE
  const selected = PR_BASE_PROMPT_OPTIONS.find(
    (option) => option.number === normalized || option.id === normalized,
  )
  if (selected) return selected.id
  return answer.trim()
}

async function promptBaseBranch(ask: AskFn): Promise<string> {
  console.log('')
  console.log('   Which branch should automated PRs target?')
  console.log('')
  for (const option of PR_BASE_PROMPT_OPTIONS) {
    const hint = 'hint' in option && option.hint ? `  — ${option.hint}` : ''
    console.log(`   ${option.number}. ${option.label}${hint}`)
  }
  console.log('')
  const answer = normalizeBaseBranchAnswer(await ask('   Enter number or branch name [1]: '))
  if (answer === 'other') {
    const custom = (await ask('   Branch name: ')).trim()
    return custom || DEFAULT_PR_BASE
  }
  return answer
}

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

  const prCapable = selectedIds.some((id) => PR_CAPABLE_TOOL_IDS.includes(id))
  let baseBranch = DEFAULT_PR_BASE
  if (options?.baseBranch != null && options.baseBranch.trim() !== '') {
    const normalized = normalizeBaseBranchAnswer(options.baseBranch)
    baseBranch = normalized === 'other' ? DEFAULT_PR_BASE : normalized
  } else if (!options?.tool && prCapable) {
    baseBranch = await promptBaseBranch(ask)
  }

  const config: AgenticConfig = {
    projectName: basename(targetDir),
    targetDir,
    agentTools: selectedIds,
    pr: { baseBranch },
  }

  // Order matters — codex patches AGENTS.md created by shared
  generateShared(config)
  if (selectedIds.includes('claude-code')) generateClaudeCode(config)
  if (selectedIds.includes('codex')) generateCodex(config)
  if (selectedIds.includes('cursor')) generateCursor(config)

  printSummary(selectedIds)
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
    console.log('   ⚡ Autonomous skills shipped under .ai/skills/:')
    console.log('      /om-auto-create-pr  <task>    — delegate a whole task end-to-end as a PR')
    console.log('      /om-auto-continue-pr <PR#>    — resume an in-progress agent PR')
    console.log('      /om-auto-review-pr   <PR#>    — automated code review (optional autofix)')
    console.log('      /om-auto-fix-github  <issue#> — fix a GitHub issue and open a PR')
    console.log('      /om-prepare-issue    <idea>   — spec out deferred work + open a tracking issue (no build)')
    console.log('      /om-trim-unused-modules       — slim classic-mode defaults after adding your own module')
    console.log('      Per-repo settings (automated-PR base branch, tool selection) live in')
    console.log('      .ai/agentic.config.json; the skills read it and fall back to your repo defaults.')
  }

  console.log('')
}
