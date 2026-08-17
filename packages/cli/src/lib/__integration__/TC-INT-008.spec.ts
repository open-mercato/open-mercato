import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..')
const cliDir = path.join(repoRoot, 'packages', 'cli')
const cliBin = path.join(cliDir, 'dist', 'bin.js')
const cliBuildScript = path.join(cliDir, 'build.mjs')
const cliIntegrationRunnerPath = path.join(cliDir, 'src', 'lib', 'testing', 'integration.ts')
const standaloneTemplatePackageJsonPath = path.join(repoRoot, 'packages', 'create-app', 'template', 'package.json.template')
const agenticRoot = path.join(repoRoot, 'packages', 'create-app', 'agentic')
const packagesRoot = path.join(repoRoot, 'packages')
const coreVersion = JSON.parse(fs.readFileSync(path.join(packagesRoot, 'core', 'package.json'), 'utf8')).version as string
const UNROUTED_PACKAGE_GUIDES = new Set(['cache', 'core', 'events', 'queue', 'search', 'shared', 'ui'])

// Modules the standalone fixture enables in src/modules.ts. Both are on the
// fact-sheet allowlist, so agentic:init must ship exactly their fact-sheets
// (enabled ∩ allowlist — spec D6) and list them in the AGENTS.md marker block.
const FIXTURE_ENABLED_MODULES = ['customers', 'sales']

function normalizePath(value: string): string {
  return value.split(path.sep).join('/')
}

function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
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
      ...env,
    },
  })
}

function runMercato(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  return runCommand(process.execPath, [cliBin, ...args], cwd, env)
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
        dependencies: { '@open-mercato/core': coreVersion },
      },
      null,
      2,
    ),
  )
  const moduleEntries = FIXTURE_ENABLED_MODULES
    .map((moduleId) => `  { id: '${moduleId}', from: '@open-mercato/core' },`)
    .join('\n')
  writeFile(path.join(appDir, 'src', 'modules.ts'), `export const enabledModules = [\n${moduleEntries}\n]\n`)
  return appDir
}

function installFakeFrameworkPackage(appDir: string): string {
  const packageRoot = path.join(appDir, 'node_modules', '@open-mercato', 'core')
  writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: '@open-mercato/core',
    version: coreVersion,
    type: 'module',
    exports: { '.': './dist/index.js' },
  }))
  writeFile(path.join(packageRoot, 'dist', 'index.js'), 'export {}\n')
  writeFile(path.join(packageRoot, 'AGENTS.md'), '# Installed core instructions\n')
  for (const moduleId of FIXTURE_ENABLED_MODULES) {
    writeFile(path.join(packageRoot, 'src', 'modules', moduleId, 'AGENTS.md'), `# Installed ${moduleId} instructions\n`)
    writeFile(
      path.join(packageRoot, 'src', 'modules', moduleId, 'data', 'entities.ts'),
      `export class ${moduleId === 'customers' ? 'Person' : 'Sale'} {}\n`,
    )
  }
  return packageRoot
}

function snapshotTextFiles(rootDir: string): Record<string, string> {
  return Object.fromEntries(
    listRelativeFiles(rootDir).map((relativePath) => [
      relativePath,
      fs.readFileSync(path.join(rootDir, relativePath), 'utf8'),
    ]),
  )
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

function mapClaudeSourceToOutput(relativePath: string): string | null {
  if (relativePath === 'CLAUDE.md.template') {
    return 'CLAUDE.md'
  }
  if (relativePath === 'settings.json') {
    return '.claude/settings.json'
  }
  if (relativePath === 'settings.experimental-hooks-validator.json') {
    return null
  }
  if (relativePath === 'mcp.json.example') {
    return '.mcp.json.example'
  }
  if (relativePath.startsWith('hooks/')) {
    if (relativePath.includes('gate-evidence.')) return null
    return normalizePath(path.join('.claude', relativePath))
  }

  throw new Error(`Unexpected Claude source path: ${relativePath}`)
}

function mapCursorSourceToOutput(relativePath: string): string | null {
  if (relativePath === 'hooks.json') {
    return '.cursor/hooks.json'
  }
  if (relativePath === 'hooks.experimental-hooks-validator.json') {
    return null
  }
  if (relativePath === 'mcp.json.example') {
    return '.cursor/mcp.json.example'
  }
  if (relativePath.startsWith('hooks/') || relativePath.startsWith('rules/')) {
    if (relativePath.includes('gate-evidence.')) return null
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
  if (relativePath === 'hooks.json' || relativePath === 'hooks/gate-evidence.mjs') {
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
    if (fs.existsSync(packageGuide) && !UNROUTED_PACKAGE_GUIDES.has(packageName)) {
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
  // the v1/v2 sidecars and disabled local-reference projection are copied as-is,
  // while installed fact-sheets are filtered to the fixture's enabled modules. The legacy
  // core.<module>.md redirect stubs are no longer
  // emitted (#3754). framework-extension-points.md is likewise generated into
  // dist/agentic/guides by both build.mjs pipelines (#4810) rather than checked in
  // alongside the static conceptual guides, so it needs an explicit entry here.
  collected.add('module-facts.json')
  collected.add('module-facts.v2.json')
  collected.add('reference-module-facts.json')
  collected.add('framework-extension-points.md')
  collected.add('upstream/AGENTS.md')
  collected.add('upstream/BACKWARD_COMPATIBILITY.md')
  collected.add('upstream/manifest.json')
  for (const moduleId of FIXTURE_ENABLED_MODULES) {
    const moduleFactsRoot = path.join(cliDir, 'dist', 'agentic', 'guides', 'modules', moduleId)
    for (const file of fs.readdirSync(moduleFactsRoot)) {
      if (file.endsWith('.md')) collected.add(normalizePath(path.join('modules', moduleId, file)))
    }
  }
  const referenceFactsRoot = path.join(cliDir, 'dist', 'agentic', 'guides', 'reference-modules')
  for (const file of listRelativeFiles(referenceFactsRoot)) {
    collected.add(normalizePath(path.join('reference-modules', file)))
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
      const claudeOutputs = listRelativeFiles(path.join(agenticRoot, 'claude-code'))
        .map(mapClaudeSourceToOutput)
        .filter((relativePath): relativePath is string => relativePath !== null)
      const cursorOutputs = listRelativeFiles(path.join(agenticRoot, 'cursor'))
        .map(mapCursorSourceToOutput)
        .filter((relativePath): relativePath is string => relativePath !== null)
      const codexOutputs = listRelativeFiles(path.join(agenticRoot, 'codex'))
        .map(mapCodexSourceToOutput)
        .filter((relativePath): relativePath is string => relativePath !== null)

      expect(sharedOutputs).toContain(standalonePlaywrightConfigPath)
      assertPathsExist(appDir, [...sharedOutputs, ...claudeOutputs, ...cursorOutputs, ...codexOutputs])
      for (const relativePath of [
        '.claude/hooks/gate-evidence.ts',
        '.codex/hooks.json',
        '.codex/hooks/gate-evidence.mjs',
        '.cursor/hooks/gate-evidence.mjs',
      ]) {
        expect(fs.existsSync(path.join(appDir, relativePath))).toBe(false)
      }
      expect(fs.readFileSync(path.join(appDir, '.claude', 'settings.json'), 'utf8')).not.toContain('gate-evidence')
      expect(fs.readFileSync(path.join(appDir, '.cursor', 'hooks.json'), 'utf8')).not.toContain('gate-evidence')
      const defaultManifest = JSON.parse(
        fs.readFileSync(path.join(appDir, '.ai', 'harness', 'manifest.json'), 'utf8'),
      ) as { files: Array<{ path: string }> }
      expect(defaultManifest.files.some((entry) => entry.path.includes('gate-evidence'))).toBe(false)
      expect(fs.existsSync(path.join(appDir, standalonePlaywrightConfigPath))).toBe(true)

      const generatedGuideNames = listRelativeFiles(path.join(appDir, '.ai', 'guides'))
      expect(generatedGuideNames).toEqual(expectedGuideOutputNames())

      const agentsSource = fs.readFileSync(path.join(appDir, 'AGENTS.md'), 'utf8')
      expect(agentsSource).toContain('<!-- CODEX_ENFORCEMENT_RULES_START -->')
      expect(agentsSource).toContain('.ai/guides/upstream/BACKWARD_COMPATIBILITY.md')

      // The Module-Specific Guides marker block is a compact enabled-module ID
      // index (enabled ∩ bundled) plus one progressively loaded path pattern.
      for (const moduleId of FIXTURE_ENABLED_MODULES) {
        expect(agentsSource).toContain(`\`${moduleId}\``)
      }
      expect(agentsSource).toContain('`.ai/guides/modules/<id>/index.md`')
      expect(agentsSource.match(/\.ai\/guides\/modules\//g)).toHaveLength(1)
      expect(agentsSource).not.toContain('`auth`')
      expect(agentsSource).not.toContain('Core CRM capabilities')

      const specsReadmeSource = fs.readFileSync(path.join(appDir, '.ai', 'specs', 'README.md'), 'utf8')
      expect(specsReadmeSource).toContain('sample-store')

      const cursorRulesSource = fs.readFileSync(path.join(appDir, '.cursor', 'rules', 'open-mercato.mdc'), 'utf8')
      expect(cursorRulesSource).toContain('sample-store')

      // om-spec-writing moved to the external open-mercato/skills collection
      // (installed via `yarn install-skills`), so agentic:init must not ship a copy.
      expect(fs.existsSync(path.join(appDir, '.ai', 'skills', 'om-spec-writing'))).toBe(false)
      expect(fs.existsSync(path.join(appDir, 'scripts', 'install-skills.sh'))).toBe(true)

      // install-skills.sh (run by agentic:init) installs every local tier skill once,
      // into the canonical .agents/skills/. Codex and Cursor read that directory
      // natively, so they get no skills directory of their own; Claude Code cannot,
      // so it keeps a link layer pointing back at the canonical copy.
      const tiersManifest = JSON.parse(
        fs.readFileSync(path.join(agenticRoot, 'shared', 'ai', 'skills', 'tiers.json'), 'utf8'),
      ) as { default: string[]; tiers: Record<string, { skills: string[] }> }
      const defaultTierSkills = tiersManifest.default.flatMap((tierName) => tiersManifest.tiers[tierName].skills)
      expect(defaultTierSkills.length).toBeGreaterThan(0)

      for (const skillName of defaultTierSkills) {
        const canonicalLinkPath = path.join(appDir, '.agents', 'skills', skillName)
        expect(fs.lstatSync(canonicalLinkPath).isSymbolicLink()).toBe(true)
        expect(normalizePath(fs.readlinkSync(canonicalLinkPath))).toBe(`../../.ai/skills/${skillName}`)

        const claudeLinkPath = path.join(appDir, '.claude', 'skills', skillName)
        expect(fs.lstatSync(claudeLinkPath).isSymbolicLink()).toBe(true)
        expect(normalizePath(fs.readlinkSync(claudeLinkPath))).toBe(`../../.agents/skills/${skillName}`)
      }

      expect(fs.existsSync(path.join(appDir, '.codex', 'skills'))).toBe(false)
      expect(fs.existsSync(path.join(appDir, '.cursor', 'skills'))).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('installs gate-evidence hooks only through the explicit flag or environment opt-in', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-agentic-hooks-'))

    try {
      const flagAppDir = createStandaloneFixture(path.join(tempRoot, 'flag'))
      runMercato([
        'agentic:init',
        '--tool=claude-code,codex,cursor',
        '--experimental-hooks-validator',
      ], flagAppDir)

      assertPathsExist(flagAppDir, [
        '.claude/hooks/gate-evidence.ts',
        '.codex/hooks.json',
        '.codex/hooks/gate-evidence.mjs',
        '.cursor/hooks/gate-evidence.mjs',
      ])
      expect(fs.readFileSync(path.join(flagAppDir, '.claude', 'settings.json'), 'utf8')).toContain('gate-evidence')
      expect(fs.readFileSync(path.join(flagAppDir, '.cursor', 'hooks.json'), 'utf8')).toContain('gate-evidence')
      const enabledManifest = JSON.parse(
        fs.readFileSync(path.join(flagAppDir, '.ai', 'harness', 'manifest.json'), 'utf8'),
      ) as { files: Array<{ path: string }> }
      expect(enabledManifest.files.filter((entry) => entry.path.includes('gate-evidence'))).toHaveLength(3)

      runMercato([
        'agentic:init',
        '--tool=claude-code,codex,cursor',
        '--update-harness',
      ], flagAppDir)
      for (const relativePath of [
        '.claude/hooks/gate-evidence.ts',
        '.codex/hooks.json',
        '.codex/hooks/gate-evidence.mjs',
        '.cursor/hooks/gate-evidence.mjs',
      ]) {
        expect(fs.existsSync(path.join(flagAppDir, relativePath))).toBe(false)
      }
      expect(fs.readFileSync(path.join(flagAppDir, '.claude', 'settings.json'), 'utf8')).not.toContain('gate-evidence')
      expect(fs.readFileSync(path.join(flagAppDir, '.cursor', 'hooks.json'), 'utf8')).not.toContain('gate-evidence')

      const envAppDir = createStandaloneFixture(path.join(tempRoot, 'environment'))
      runMercato(['agentic:init', '--tool=codex'], envAppDir, {
        OM_HARNESS_EXPERIMENTAL_HOOKS_VALIDATOR: '1',
      })
      assertPathsExist(envAppDir, [
        '.codex/hooks.json',
        '.codex/hooks/gate-evidence.mjs',
      ])
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('emits a runnable exact-version framework context escape hatch for an installed package', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-cli-framework-context-'))

    try {
      const appDir = createStandaloneFixture(tempRoot)
      const packageRoot = installFakeFrameworkPackage(appDir)
      const resolvedPackageRoot = fs.realpathSync(packageRoot)
      const packageBefore = snapshotTextFiles(packageRoot)

      runMercato(['agentic:init', '--tool=codex'], appDir)
      const generatedScript = path.join(appDir, 'scripts', 'framework-context.mjs')
      expect(fs.existsSync(generatedScript)).toBe(true)

      const output = runCommand(
        process.execPath,
        [generatedScript, '--module', 'customers', '--query', 'Person', '--json'],
        appDir,
        // The generated standalone helper must not depend on a globally
        // installed ripgrep binary; process.execPath is already absolute.
        { PATH: '', Path: '' },
      )
      const context = JSON.parse(output) as {
        module: string
        package: { name: string; version: string; root: string }
        sourceKind: string
        sourceRoot: string
        materializedSource: string
        instructions: Array<{ kind: string; path: string | null; materializedPath?: string }>
        boundedSearch: { status: string; matches: number; maxMatches: number; result: string }
        warnings: string[]
      }

      expect(context.module).toBe('customers')
      expect(context.package).toEqual({ name: '@open-mercato/core', version: coreVersion, root: resolvedPackageRoot })
      expect(context.sourceKind).toBe('source')
      expect(normalizePath(context.sourceRoot)).toBe(normalizePath(path.join(resolvedPackageRoot, 'src', 'modules', 'customers')))
      expect(context.instructions.filter((entry) => entry.path).map((entry) => entry.kind)).toEqual([
        'standalone-root',
        'upstream-bc',
        'package',
        'module-1',
        'upstream-root',
      ])
      expect(context.instructions.filter((entry) => entry.path).every((entry) => entry.materializedPath)).toBe(true)
      expect(context.boundedSearch).toMatchObject({ status: 'matched', matches: 1, maxMatches: 200 })
      expect(fs.existsSync(path.join(appDir, context.materializedSource))).toBe(true)
      expect(fs.existsSync(path.join(appDir, context.boundedSearch.result))).toBe(true)
      expect(context.warnings.some((warning) => warning.includes('Generated facts for customers are stale'))).toBe(false)
      expect(snapshotTextFiles(packageRoot)).toEqual(packageBefore)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
