import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function isStandaloneAppRoot(rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, 'package.json'))
    && fs.existsSync(path.join(rootDir, 'src', 'modules.ts'))
}

function resolveMercatoBin(rootDir: string): string {
  const candidates = [
    path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'mercato.cmd' : 'mercato'),
    path.join(rootDir, 'node_modules', '@open-mercato', 'cli', 'bin', 'mercato'),
  ]

  const match = candidates.find((candidate) => fs.existsSync(candidate))
  if (!match) {
    throw new Error(`Could not find mercato bin. Checked: ${candidates.join(', ')}`)
  }

  return match
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8')
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
}

function runMercato(
  mercatoBin: string,
  args: string[],
  cwd: string,
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(mercatoBin, args, {
    cwd,
    encoding: 'utf-8',
    timeout: 60_000,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_NO_WARNINGS: '1',
    },
  })

  if (result.error) {
    throw result.error
  }

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

test.describe('TC-CLI-001: Standalone agentic:init parity', () => {
  test('agentic:init generates files, scopes overwrite warnings by tool, and honors --force', () => {
    const standaloneRoot = process.cwd()
    test.skip(!isStandaloneAppRoot(standaloneRoot), 'Standalone create-app parity only')
    test.skip(
      fs.existsSync(path.join(standaloneRoot, '.codex', 'mcp.json.example'))
        || fs.existsSync(path.join(standaloneRoot, '.cursor', 'hooks.json')),
      'This standalone app already has agentic files configured',
    )

    const mercatoBin = resolveMercatoBin(standaloneRoot)
    const initialCodexRun = runMercato(mercatoBin, ['agentic:init', '--tool', 'codex'], standaloneRoot)
    expect(initialCodexRun.exitCode).toBe(0)
    expect(initialCodexRun.stderr).toBe('')
    expect(initialCodexRun.stdout).toContain('Agentic setup complete:')
    expect(initialCodexRun.stdout).toContain('✓ Codex')
    expect(fs.existsSync(path.join(standaloneRoot, 'AGENTS.md'))).toBe(true)
    expect(fs.existsSync(path.join(standaloneRoot, '.ai', 'specs', 'README.md'))).toBe(true)
    expect(fs.existsSync(path.join(standaloneRoot, '.codex', 'mcp.json.example'))).toBe(true)

    const initialAgentsSource = readFile(path.join(standaloneRoot, 'AGENTS.md'))
    expect(initialAgentsSource).toContain('CODEX_ENFORCEMENT_RULES_START')
    expect(countMatches(initialAgentsSource, /CODEX_ENFORCEMENT_RULES_START/g)).toBe(1)

    const warningRun = runMercato(mercatoBin, ['agentic:init', '--tool=codex'], standaloneRoot)
    expect(warningRun.exitCode).toBe(0)
    expect(warningRun.stderr).toBe('')
    expect(warningRun.stdout).toContain('⚠️  Agentic files already exist:')
    expect(warningRun.stdout).toContain('.codex/mcp.json.example')
    expect(warningRun.stdout).toContain('Run with --force to regenerate from current templates.')

    const forcedRun = runMercato(mercatoBin, ['agentic:init', '--tool', 'codex', '--force'], standaloneRoot)
    expect(forcedRun.exitCode).toBe(0)
    expect(forcedRun.stderr).toBe('')
    expect(forcedRun.stdout).toContain('Agentic setup complete:')
    expect(forcedRun.stdout).not.toContain('⚠️  Agentic files already exist:')

    const forcedAgentsSource = readFile(path.join(standaloneRoot, 'AGENTS.md'))
    expect(countMatches(forcedAgentsSource, /CODEX_ENFORCEMENT_RULES_START/g)).toBe(1)

    const cursorRun = runMercato(mercatoBin, ['agentic:init', '--tool', 'cursor'], standaloneRoot)
    expect(cursorRun.exitCode).toBe(0)
    expect(cursorRun.stderr).toBe('')
    expect(cursorRun.stdout).toContain('Agentic setup complete:')
    expect(cursorRun.stdout).toContain('✓ Cursor')
    expect(cursorRun.stdout).not.toContain('⚠️  Agentic files already exist:')
    expect(fs.existsSync(path.join(standaloneRoot, '.cursor', 'hooks.json'))).toBe(true)
    expect(fs.existsSync(path.join(standaloneRoot, '.cursor', 'hooks', 'entity-migration-check.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(standaloneRoot, '.cursor', 'mcp.json.example'))).toBe(true)
  })
})
