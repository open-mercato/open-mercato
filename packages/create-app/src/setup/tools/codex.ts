import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgenticConfig } from '../wizard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AGENTIC_DIR = join(__dirname, 'agentic', 'codex')

const MARKER_START = '<!-- CODEX_ENFORCEMENT_RULES_START -->'
const MARKER_END = '<!-- CODEX_ENFORCEMENT_RULES_END -->'

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function copyFile(srcRelative: string, destPath: string): void {
  const srcPath = join(AGENTIC_DIR, srcRelative)
  ensureDir(destPath)
  copyFileSync(srcPath, destPath)
}

export function generateCodex(config: AgenticConfig): void {
  const { targetDir } = config

  // Patch AGENTS.md with enforcement rules
  const agentsPath = join(targetDir, 'AGENTS.md')
  const rulesPath = join(AGENTIC_DIR, 'enforcement-rules.md')

  if (existsSync(agentsPath)) {
    let agents = readFileSync(agentsPath, 'utf-8')
    const rules = readFileSync(rulesPath, 'utf-8')

    // Idempotency: replace existing block if present
    if (agents.includes(MARKER_START)) {
      const startIdx = agents.indexOf(MARKER_START)
      const endIdx = agents.indexOf(MARKER_END)
      if (endIdx !== -1) {
        agents = agents.slice(0, startIdx) + rules + agents.slice(endIdx + MARKER_END.length)
      }
    } else {
      // Prepend after first heading line
      const firstNewline = agents.indexOf('\n')
      if (firstNewline !== -1) {
        agents = agents.slice(0, firstNewline + 1) + '\n' + rules + '\n' + agents.slice(firstNewline + 1)
      } else {
        agents = agents + '\n\n' + rules
      }
    }

    writeFileSync(agentsPath, agents)
  }

  // .codex/mcp.json.example
  copyFile('mcp.json.example', join(targetDir, '.codex', 'mcp.json.example'))

  // Symlink .codex/skills → ../.ai/skills
  ensureSkillsLink(join(targetDir, '.codex', 'skills'), join('..', '.ai', 'skills'))
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
