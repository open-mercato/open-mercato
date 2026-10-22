import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function createPackage(packageRoot: string, packageName: string, moduleIds: string[]): void {
  writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: packageName, version: '0.4.7', type: 'module' }))
  for (const moduleId of moduleIds) {
    writeFile(path.join(packageRoot, 'src', 'modules', moduleId, 'index.ts'), `export const metadata = { id: '${moduleId}', title: '${moduleId}', ejectable: true }\n`)
    writeFile(path.join(packageRoot, 'dist', 'modules', moduleId, 'index.js'), `export const metadata = { id: '${moduleId}', title: '${moduleId}', ejectable: true }\n`)
    writeFile(path.join(packageRoot, 'src', 'modules', moduleId, 'di.ts'), 'export function register() {}\n')
    writeFile(path.join(packageRoot, 'dist', 'modules', moduleId, 'di.js'), 'export function register() {}\n')
  }
}

function createApp(appDir: string, dependencies: Record<string, string> = {}): void {
  writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: 'module-collision-integration', private: true, dependencies: { '@open-mercato/core': '0.4.7', ...dependencies } }))
  writeFile(path.join(appDir, 'yarn.lock'), '')
  writeFile(path.join(appDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
  createPackage(path.join(appDir, 'node_modules', '@open-mercato', 'core'), '@open-mercato/core', [])
}

function runMercato(args: string[], appDir: string, environment: NodeJS.ProcessEnv = {}): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [cliBin, ...args], {
    cwd: appDir,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1', ...environment },
  })
  if (result.error) throw result.error
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

function installCommandStubs(appDir: string, candidateName?: string, candidateModuleId?: string): NodeJS.ProcessEnv {
  const executableDir = path.join(appDir, 'bin')
  const marker = path.join(appDir, 'yarn-invoked')
  const yarnPath = path.join(executableDir, process.platform === 'win32' ? 'yarn.cmd' : 'yarn')
  const yarnScript = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'invoked'); process.exit(1)\n`
  writeFile(yarnPath, process.platform === 'win32'
    ? `@"${process.execPath}" "%~dp0yarn-stub.cjs" %*\r\n`
    : `#!${process.execPath}\n${yarnScript}`)
  writeFile(path.join(executableDir, 'yarn-stub.cjs'), yarnScript)
  fs.chmodSync(yarnPath, 0o755)
  if (candidateName && candidateModuleId) {
    const manifest = Buffer.from(JSON.stringify({ name: candidateName })).toString('base64')
    const ghScript = `const endpoint = process.argv[3] || ''
const value = endpoint === 'user' ? { login: 'candidate' }
  : endpoint.includes('/commits/') ? { sha: 'a'.repeat(40) }
  : endpoint.includes('/contents/') ? { encoding: 'base64', content: ${JSON.stringify(manifest)} }
  : endpoint.includes('/git/trees/') ? { tree: [{ path: 'src/modules/${candidateModuleId}/index.ts' }, { path: 'dist/modules/${candidateModuleId}/index.js' }] }
  : { default_branch: 'main' }
process.stdout.write(JSON.stringify(value))\n`
    const ghPath = path.join(executableDir, process.platform === 'win32' ? 'gh.cmd' : 'gh')
    writeFile(ghPath, process.platform === 'win32'
      ? `@"${process.execPath}" "%~dp0gh-stub.cjs" %*\r\n`
      : `#!${process.execPath}\n${ghScript}`)
    writeFile(path.join(executableDir, 'gh-stub.cjs'), ghScript)
    fs.chmodSync(ghPath, 0o755)
  }
  return { PATH: executableDir + path.delimiter + process.env.PATH }
}

function snapshotDirectory(directory: string): Record<string, string> {
  if (!fs.existsSync(directory)) return {}
  const files: Record<string, string> = {}
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      for (const [relativePath, content] of Object.entries(snapshotDirectory(fullPath))) files[path.join(entry.name, relativePath)] = content
    } else {
      files[entry.name] = fs.readFileSync(fullPath).toString('base64')
    }
  }
  return files
}

test.describe('TC-INT-009: CLI source collision lifecycle safeguards', () => {
  test('rejects a GitHub replacement of an active binding even when the selected module ID differs', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-binding-collision-'))
    try {
      const binding = '@publisher/shared-package'
      createApp(appDir, { [binding]: 'github:existing/provider#main' })
      createPackage(path.join(appDir, 'node_modules', binding), binding, ['active_module'])
      const modulesSource = `export const enabledModules = [{ id: 'active_module', from: '${binding}', locator: 'github:existing/provider', packageName: '${binding}' }]\n`
      writeFile(path.join(appDir, 'src', 'modules.ts'), modulesSource)
      const manifestBefore = fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')
      const environment = installCommandStubs(appDir, binding, 'candidate_module')
      const result = runMercato(['module', 'add', 'github:candidate/provider', '--allow-third-party'], appDir, environment)

      expect(result.status, result.output).not.toBe(0)
      expect(result.output).toContain('active_module')
      expect(result.output).toContain(binding)
      expect(result.output).toContain('github:existing/provider')
      expect(result.output).toContain('github:candidate/provider')
      expect(fs.existsSync(path.join(appDir, 'yarn-invoked'))).toBe(false)
      expect(fs.readFileSync(path.join(appDir, 'src', 'modules.ts'), 'utf8')).toBe(modulesSource)
      expect(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).toBe(manifestBefore)
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'candidate_module'))).toBe(false)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('rejects an npm file package runtime ID collision before invoking Yarn or copying sources', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-file-collision-'))
    try {
      createApp(appDir)
      const candidateDir = path.join(appDir, 'candidate')
      createPackage(candidateDir, '@publisher/candidate', ['consents'])
      const modulesSource = "export const enabledModules = [{ id: 'consents', from: '@app', locator: 'github:existing/consents' }]\n"
      writeFile(path.join(appDir, 'src', 'modules.ts'), modulesSource)
      writeFile(path.join(appDir, 'src', 'modules', 'consents', 'index.ts'), 'export const metadata = { ejectable: true }\n')
      const sourceBefore = snapshotDirectory(path.join(appDir, 'src'))
      const manifestBefore = fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')
      const result = runMercato(['module', 'add', '@publisher/candidate@file:./candidate', '--allow-third-party', '--eject'], appDir, installCommandStubs(appDir))

      expect(result.status, result.output).not.toBe(0)
      expect(result.output).toContain('consents')
      expect(result.output).toMatch(/collision|already registered|conflict/i)
      expect(fs.existsSync(path.join(appDir, 'yarn-invoked'))).toBe(false)
      expect(snapshotDirectory(path.join(appDir, 'src'))).toEqual(sourceBefore)
      expect(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).toBe(manifestBefore)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('every generate command rejects duplicate effective registrations before changing existing output', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-generate-duplicates-'))
    try {
      createApp(appDir)
      writeFile(path.join(appDir, 'src', 'modules.ts'), "export const enabledModules = [{ id: 'consents', from: '@app' }]\nif (process.env.COLLISION_DUPLICATE_ENABLED === 'true') enabledModules.push({ id: 'consents', from: '@app' })\n")
      writeFile(path.join(appDir, 'src', 'modules', 'consents', 'index.ts'), 'export const metadata = {}\n')
      const outputDir = path.join(appDir, '.mercato', 'generated')
      for (const file of ['entities.ids.generated.ts', 'modules.generated.ts', 'entities.generated.ts', 'di.generated.ts', 'module-package-sources.css']) writeFile(path.join(outputDir, file), 'preserved output\n')
      const before = snapshotDirectory(outputDir)

      for (const command of ['all', 'entity-ids', 'registry', 'entities', 'di']) {
        const result = runMercato(['generate', command, '--quiet'], appDir, { COLLISION_DUPLICATE_ENABLED: 'true' })
        expect(result.status, `${command}: ${result.output}`).not.toBe(0)
        expect(result.output).toContain("Duplicate enabled module ID 'consents'")
        expect(snapshotDirectory(outputDir), command).toEqual(before)
      }
      const singleProvider = runMercato(['generate', 'all', '--quiet'], appDir, { COLLISION_DUPLICATE_ENABLED: 'false' })
      expect(singleProvider.status, singleProvider.output).toBe(0)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('an installed alias generates binding imports, ejects with canonical provenance, and disables cleanly', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-alias-lifecycle-'))
    try {
      const binding = 'consents_candidate'
      const canonicalName = '@publisher/consents'
      createApp(appDir, { [binding]: `npm:${canonicalName}@0.4.7` })
      const packageRoot = path.join(appDir, 'node_modules', binding)
      createPackage(packageRoot, canonicalName, ['consents', 'sibling'])
      writeFile(path.join(packageRoot, 'src', 'modules', 'consents', 'sibling.ts'), "export { metadata } from '../sibling'\n")
      const enabled = runMercato(['module', 'enable', binding, '--module', 'consents', '--allow-third-party'], appDir)
      expect(enabled.status, enabled.output).toBe(0)
      const outputDir = path.join(appDir, '.mercato', 'generated')
      const modulesSource = fs.readFileSync(path.join(appDir, 'src', 'modules.ts'), 'utf8')
      expect(modulesSource).toContain(`from: '${binding}'`)
      expect(modulesSource).toContain(`packageName: '${canonicalName}'`)
      expect(fs.readFileSync(path.join(outputDir, 'di.generated.ts'), 'utf8')).toContain(`${binding}/modules/consents/di`)
      expect(fs.readFileSync(path.join(outputDir, 'module-package-sources.css'), 'utf8')).toContain(`node_modules/${binding}/src/`)

      const ejected = runMercato(['module', 'eject', 'consents'], appDir)
      expect(ejected.status, ejected.output).toBe(0)
      const ejectedSource = fs.readFileSync(path.join(appDir, 'src', 'modules.ts'), 'utf8')
      expect(ejectedSource).toContain("from: '@app'")
      expect(ejectedSource).toContain(`packageName: '${canonicalName}'`)
      expect(ejectedSource).toContain(`locator: 'npm:${canonicalName}'`)
      expect(fs.readFileSync(path.join(appDir, 'src', 'modules', 'consents', 'sibling.ts'), 'utf8')).toContain(`${binding}/modules/sibling`)

      writeFile(path.join(appDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
      const disabled = runMercato(['generate', 'all', '--quiet'], appDir)
      expect(disabled.status, disabled.output).toBe(0)
      expect(fs.readFileSync(path.join(outputDir, 'di.generated.ts'), 'utf8')).not.toContain('consents')
      expect(fs.readFileSync(path.join(outputDir, 'module-package-sources.css'), 'utf8')).toBe('')
      expect(fs.existsSync(path.join(packageRoot, 'package.json'))).toBe(true)
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'consents', 'index.ts'))).toBe(true)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('missing alias exports fail enable and direct eject before source or config changes', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-alias-exports-'))
    try {
      const binding = 'consents_candidate'
      createApp(appDir, { [binding]: 'npm:@publisher/consents@0.4.7' })
      const packageRoot = path.join(appDir, 'node_modules', binding)
      createPackage(packageRoot, '@publisher/consents', ['consents'])
      writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@publisher/consents', exports: { '.': './dist/modules/consents/index.js' } }))
      const configPath = path.join(appDir, 'src', 'modules.ts')
      const emptyConfig = fs.readFileSync(configPath, 'utf8')

      const enabled = runMercato(['module', 'enable', binding, '--module', 'consents', '--eject', '--allow-third-party'], appDir)
      expect(enabled.status, enabled.output).not.toBe(0)
      expect(enabled.output).toContain(`${binding}/modules/consents/`)
      expect(fs.readFileSync(configPath, 'utf8')).toBe(emptyConfig)
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'consents'))).toBe(false)

      const registeredConfig = `export const enabledModules = [{ id: 'consents', from: '${binding}' }]\n`
      writeFile(configPath, registeredConfig)
      const ejected = runMercato(['module', 'eject', 'consents'], appDir)
      expect(ejected.status, ejected.output).not.toBe(0)
      expect(ejected.output).toContain(`${binding}/modules/consents/`)
      expect(fs.readFileSync(configPath, 'utf8')).toBe(registeredConfig)
      expect(fs.existsSync(path.join(appDir, 'src', 'modules', 'consents'))).toBe(false)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })

  test('a single package registration with a local overlay remains valid', () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-single-overlay-'))
    try {
      const binding = '@publisher/consents'
      createApp(appDir, { [binding]: '0.4.7' })
      createPackage(path.join(appDir, 'node_modules', binding), binding, ['consents'])
      writeFile(path.join(appDir, 'src', 'modules.ts'), `export const enabledModules = [{ id: 'consents', from: '${binding}' }]\n`)
      writeFile(path.join(appDir, 'src', 'modules', 'consents', 'index.ts'), "export const metadata = { title: 'Local overlay' }\n")
      const before = snapshotDirectory(path.join(appDir, 'src'))

      const result = runMercato(['generate', 'all', '--quiet'], appDir)

      expect(result.status, result.output).toBe(0)
      expect(snapshotDirectory(path.join(appDir, 'src'))).toEqual(before)
      expect(fs.readFileSync(path.join(appDir, '.mercato', 'generated', 'di.generated.ts'), 'utf8')).toContain(`${binding}/modules/consents/di`)
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true })
    }
  })
})
