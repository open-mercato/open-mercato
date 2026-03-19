import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgenticConfig } from '../wizard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AGENTIC_DIR = join(__dirname, 'agentic', 'cursor')

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

export function generateCursor(config: AgenticConfig): void {
  const { targetDir } = config

  // .cursor/rules/*.mdc (open-mercato.mdc needs placeholder substitution)
  writeTemplate('rules/open-mercato.mdc', join(targetDir, '.cursor', 'rules', 'open-mercato.mdc'), config)
  copyFile('rules/entity-guard.mdc', join(targetDir, '.cursor', 'rules', 'entity-guard.mdc'))
  copyFile('rules/generated-guard.mdc', join(targetDir, '.cursor', 'rules', 'generated-guard.mdc'))

  // .cursor/hooks.json
  copyFile('hooks.json', join(targetDir, '.cursor', 'hooks.json'))

  // .cursor/hooks/entity-migration-check.mjs
  copyFile('hooks/entity-migration-check.mjs', join(targetDir, '.cursor', 'hooks', 'entity-migration-check.mjs'))

  // .cursor/mcp.json.example
  copyFile('mcp.json.example', join(targetDir, '.cursor', 'mcp.json.example'))

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
