import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODULE_FACTS_ALLOWLIST } from '../generators/module-facts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..')
const cliDir = path.join(repoRoot, 'packages', 'cli')
const cliBin = path.join(cliDir, 'dist', 'bin.js')
const cliBuildScript = path.join(cliDir, 'build.mjs')
const cliIntegrationRunnerPath = path.join(cliDir, 'src', 'lib', 'testing', 'integration.ts')
const standaloneTemplatePackageJsonPath = path.join(repoRoot, 'packages', 'create-app', 'template', 'package.json.template')
const agenticRoot = path.join(repoRoot, 'packages', 'create-app', 'agentic')
const packagesRoot = path.join(repoRoot, 'packages')

// Modules the standalone fixture enables in src/modules.ts. Both are on the
// fact-sheet allowlist, so agentic:init must ship exactly their fact-sheets
// (enabled ∩ allowlist — spec D6) and list them in the AGENTS.md marker block.
const FIXTURE_ENABLED_MODULES = ['customers', 'sales']

function normalizePath(value: string): string {
  return value.split(path.sep).join('/')
}

function runCommand(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_NO_WARNINGS: '1',
      // Keep the test hermetic: agentic:init runs scripts/install-skills.sh,
      // whose external step (`npx skills add`) needs the network. Local tier
      // symlinks are still installed.
      OM_SKIP_EXTERNAL_SKILLS: '1',
    },
  })
}

function runMercato(args: string[], cwd: string): string {
  return runCommand(process.execPath, [cliBin, ...args], cwd)
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function ensureCliBuilt(): void {
  runCommand(process.execPath, [cliBuildScript], cliDir)
}

function createStandaloneFixture(rootDir: string): string {
  const appDir = path.join(rootDir, 'sample-store')
  writeFile(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: 'sample-store',
        private: true,
      },
      null,
      2,
    ),
  )
  const moduleEntries = FIXTURE_ENABLED_MODULES.map((moduleId) => `  { id: '${moduleId}' },`).join('\n')
  writeFile(path.join(appDir, 'src', 'modules.ts'), `export const enabledModules = [\n${moduleEntries}\n]\n`)
  return appDir
}

function listRelativeFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return []
  }

  const collected: string[] = []
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const absolutePath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      for (const nestedPath of listRelativeFiles(absolutePath)) {
        collected.push(path.join(entry.name, nestedPath))
      }
      continue
    }
    if (entry.isFile()) {
      collected.push(entry.name)
    }
  }

  return collected.map(normalizePath).sort()
}

function mapSharedSourceToOutput(relativePath: string): string {
  if (relativePath === 'AGENTS.md.template') {
    return 'AGENTS.md'
  }

  if (relativePath.startsWith('scripts/')) {
    return relativePath
  }

  if (!relativePath.startsWith('ai/')) {
    throw new Error(`Unexpected shared source path: ${relativePath}`)
  }

  return normalizePath(path.join('.ai', relativePath.slice('ai/'.length)))
}

function mapClaudeSourceToOutput(relativePath: string): string {
  if (relativePath === 'CLAUDE.md.template') {
    return 'CLAUDE.md'
  }
  if (relativePath === 'settings.json') {
    return '.claude/settings.json'
  }
  if (relativePath === 'mcp.json.example') {
    return '.mcp.json.example'
  }
  if (relativePath.startsWith('hooks/')) {
    return normalizePath(path.join('.claude', relativePath))
  }

  throw new Error(`Unexpected Claude source path: ${relativePath}`)
}

function mapCursorSourceToOutput(relativePath: string): string {
  if (relativePath === 'hooks.json') {
    return '.cursor/hooks.json'
  }
  if (relativePath === 'mcp.json.example') {
    return '.cursor/mcp.json.example'
  }
  if (relativePath.startsWith('hooks/') || relativePath.startsWith('rules/')) {
    return normalizePath(path.join('.cursor', relativePath))
  }

  throw new Error(`Unexpected Cursor source path: ${relativePath}`)
}

function mapCodexSourceToOutput(relativePath: string): string | null {
  if (relativePath === 'mcp.json.example') {
    return '.codex/mcp.json.example'
  }
  if (relativePath === 'enforcement-rules.md') {
    return null
  }

  throw new Error(`Unexpected Codex source path: ${relativePath}`)
}

function readPlaywrightConfigPathFromTemplate(): string {
  const packageTemplate = JSON.parse(fs.readFileSync(standaloneTemplatePackageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>
  }
  const integrationScript = packageTemplate.scripts?.['test:integration']
  if (!integrationScript) {
    throw new Error('Standalone template is missing the test:integration script')
  }

  const configPathMatch = integrationScript.match(/--config\s+([^\s]+)/)
  if (!configPathMatch?.[1]) {
    throw new Error('Standalone template test:integration script is missing --config')
  }

  return normalizePath(configPathMatch[1])
}

function readPlaywrightConfigPathFromCliRunner(): string {
  const integrationRunnerSource = fs.readFileSync(cliIntegrationRunnerPath, 'utf8')
  const configPathMatch = integrationRunnerSource.match(/const PLAYWRIGHT_INTEGRATION_CONFIG_PATH = '([^']+)'/)
  if (!configPathMatch?.[1]) {
    throw new Error('CLI integration runner is missing PLAYWRIGHT_INTEGRATION_CONFIG_PATH')
  }

  return normalizePath(configPathMatch[1])
}

function expectedGuideOutputNames(): string[] {
  const collected = new Set<string>()

  // Static conceptual guides checked into create-app (e.g. module-system.md) are
  // bundled into dist/agentic/guides by the CLI build and copied wholesale.
  const staticGuidesRoot = path.join(agenticRoot, 'guides')
  if (fs.existsSync(staticGuidesRoot)) {
    for (const entry of fs.readdirSync(staticGuidesRoot, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        collected.add(entry.name)
      }
    }
  }

  for (const packageName of fs.readdirSync(packagesRoot)) {
    const packageGuide = path.join(packagesRoot, packageName, 'agentic', 'standalone-guide.md')
    if (fs.existsSync(packageGuide)) {
      collected.add(`${packageName}.md`)
    }

    const modulesRoot = path.join(packagesRoot, packageName, 'src', 'modules')
    if (!fs.existsSync(modulesRoot)) {
      continue
    }

    for (const moduleName of fs.readdirSync(modulesRoot)) {
      const moduleGuide = path.join(modulesRoot, moduleName, 'agentic', 'standalone-guide.md')
      if (fs.existsSync(moduleGuide)) {
        collected.add(`${packageName}.${moduleName}.md`)
      }
    }
  }

  // Generated fact-sheet artifacts (spec 2026-06-27-ts-morph-module-fact-sheets):
  // the module-facts.json sidecar is copied as-is, fact-sheets are filtered to the
  // fixture's enabled modules, and every allowlisted module whose hand-written
  // core.<module>.md guide no longer exists gets a legacy redirect stub.
  collected.add('module-facts.json')
  for (const moduleId of FIXTURE_ENABLED_MODULES) {
    collected.add(normalizePath(path.join('modules', `${moduleId}.md`)))
  }
  for (const moduleId of MODULE_FACTS_ALLOWLIST) {
    const legacyGuideSource = path.join(packagesRoot, 'core', 'src', 'modules', moduleId, 'agentic', 'standalone-guide.md')
    if (!fs.existsSync(legacyGuideSource)) {
      collected.add(`core.${moduleId}.md`)
    }
  }

  return Array.from(collected).sort()
}

function assertPathsExist(appDir: string, relativePaths: string[]): void {
  const missingPaths = relativePaths.filter((relativePath) => !fs.existsSync(path.join(appDir, relativePath)))
  expect(missingPaths).toEqual([])
}

test.describe('TC-INT-008: CLI agentic init mirrors standalone scaffolding assets', () => {
  test.beforeAll(() => {
    ensureCliBuilt()
  })

  test('should run bootstrap-free and generate the shared, guide, and tool-specific agentic files', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-agentic-'))

    try {
      const appDir = createStandaloneFixture(tempRoot)
      const standalonePlaywrightConfigPath = readPlaywrightConfigPathFromTemplate()
      const cliPlaywrightConfigPath = readPlaywrightConfigPathFromCliRunner()
      const commandOutput = runMercato(['agentic:init', '--tool=claude-code,codex,cursor'], appDir)

      expect(cliPlaywrightConfigPath).toBe(standalonePlaywrightConfigPath)
      expect(commandOutput).toContain('Agentic setup complete:')
      expect(fs.existsSync(path.join(appDir, '.mercato', 'generated'))).toBe(false)

      const sharedOutputs = listRelativeFiles(path.join(agenticRoot, 'shared')).map(mapSharedSourceToOutput)
      const claudeOutputs = listRelativeFiles(path.join(agenticRoot, 'claude-code')).map(mapClaudeSourceToOutput)
      const cursorOutputs = listRelativeFiles(path.join(agenticRoot, 'cursor')).map(mapCursorSourceToOutput)
      const codexOutputs = listRelativeFiles(path.join(agenticRoot, 'codex'))
        .map(mapCodexSourceToOutput)
        .filter((relativePath): relativePath is string => relativePath !== null)

      expect(sharedOutputs).toContain(standalonePlaywrightConfigPath)
      assertPathsExist(appDir, [...sharedOutputs, ...claudeOutputs, ...cursorOutputs, ...codexOutputs])
      expect(fs.existsSync(path.join(appDir, standalonePlaywrightConfigPath))).toBe(true)

      const generatedGuideNames = listRelativeFiles(path.join(appDir, '.ai', 'guides'))
      expect(generatedGuideNames).toEqual(expectedGuideOutputNames())

      const agentsSource = fs.readFileSync(path.join(appDir, 'AGENTS.md'), 'utf8')
      expect(agentsSource).toContain('<!-- CODEX_ENFORCEMENT_RULES_START -->')
      expect(agentsSource).toContain('.ai/guides/core.md')

      // The Module-Specific Guides marker block lists exactly the enabled modules'
      // fact-sheets (enabled ∩ allowlist), not the full bundled set.
      for (const moduleId of FIXTURE_ENABLED_MODULES) {
        expect(agentsSource).toContain(`.ai/guides/modules/${moduleId}.md`)
      }
      expect(agentsSource).not.toContain('.ai/guides/modules/auth.md')

      const specsReadmeSource = fs.readFileSync(path.join(appDir, '.ai', 'specs', 'README.md'), 'utf8')
      expect(specsReadmeSource).toContain('sample-store')

      const cursorRulesSource = fs.readFileSync(path.join(appDir, '.cursor', 'rules', 'open-mercato.mdc'), 'utf8')
      expect(cursorRulesSource).toContain('sample-store')

      // om-spec-writing moved to the external open-mercato/skills collection
      // (installed via `yarn install-skills`), so agentic:init must not ship a copy.
      expect(fs.existsSync(path.join(appDir, '.ai', 'skills', 'om-spec-writing'))).toBe(false)
      expect(fs.existsSync(path.join(appDir, 'scripts', 'install-skills.sh'))).toBe(true)

      // install-skills.sh (run by agentic:init) replaces the legacy directory-level
      // .claude/skills and .codex/skills symlinks with real directories holding one
      // symlink per default-tier local skill; .cursor/skills keeps the directory link.
      const cursorSkillsLinkPath = path.join(appDir, '.cursor', 'skills')
      expect(fs.lstatSync(cursorSkillsLinkPath).isSymbolicLink()).toBe(true)
      expect(normalizePath(fs.readlinkSync(cursorSkillsLinkPath))).toBe('../.ai/skills')

      const tiersManifest = JSON.parse(
        fs.readFileSync(path.join(agenticRoot, 'shared', 'ai', 'skills', 'tiers.json'), 'utf8'),
      ) as { default: string[]; tiers: Record<string, { skills: string[] }> }
      const defaultTierSkills = tiersManifest.default.flatMap((tierName) => tiersManifest.tiers[tierName].skills)
      expect(defaultTierSkills.length).toBeGreaterThan(0)

      for (const toolDir of ['.claude', '.codex']) {
        const harnessSkillsDir = path.join(appDir, toolDir, 'skills')
        expect(fs.lstatSync(harnessSkillsDir).isDirectory()).toBe(true)
        for (const skillName of defaultTierSkills) {
          const skillLinkPath = path.join(harnessSkillsDir, skillName)
          expect(fs.lstatSync(skillLinkPath).isSymbolicLink()).toBe(true)
          expect(normalizePath(fs.readlinkSync(skillLinkPath))).toBe(`../../.ai/skills/${skillName}`)
        }
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
