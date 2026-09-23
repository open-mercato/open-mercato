import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgenticConfig } from '../wizard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AGENTIC_DIR = join(__dirname, 'agentic', 'github-copilot')

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

export function generateGithubCopilot(config: AgenticConfig): void {
  const { targetDir } = config

  // .github/copilot-instructions.md (repo-wide custom instructions)
  writeTemplate('copilot-instructions.md.template', join(targetDir, '.github', 'copilot-instructions.md'), config)

  // .github/instructions/*.instructions.md (path-scoped guards via applyTo globs)
  copyFile('instructions/entity-guard.instructions.md', join(targetDir, '.github', 'instructions', 'entity-guard.instructions.md'))
  copyFile('instructions/generated-guard.instructions.md', join(targetDir, '.github', 'instructions', 'generated-guard.instructions.md'))

  // .vscode/mcp.json.example
  copyFile('mcp.json.example', join(targetDir, '.vscode', 'mcp.json.example'))

  // Symlink .github/skills → ../.ai/skills
  ensureSkillsLink(join(targetDir, '.github', 'skills'), join('..', '.ai', 'skills'))
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
