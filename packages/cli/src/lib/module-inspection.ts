import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import spawn from 'cross-spawn'
import { assertModulePackageExports } from './module-package'

export type InspectedModuleTarget = {
  packageName: string
  packageSpec: string
  moduleIds: string[]
  locator: string
  version?: string
}

type ArtifactInspection = { moduleIds: string[]; version?: string }

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function inspectFiles(manifest: Record<string, unknown>, packageName: string, files: string[], requiredModuleIds: readonly string[], readSource: (relativePath: string) => string): ArtifactInspection {
  if (manifest.name !== packageName) throw new Error(`Inspected package does not match "${packageName}". No package was installed.`)
  const moduleIds = [...new Set(files.flatMap((file) => {
    const match = /^src\/modules\/([a-z0-9]+(?:_[a-z0-9]+)*)\/index\.ts$/.exec(file)
    return match && files.includes(`dist/modules/${match[1]}/index.js`) ? [match[1]] : []
  }))]
  const checkedModuleIds = requiredModuleIds.length ? requiredModuleIds : moduleIds.length === 1 ? moduleIds : []
  for (const moduleId of checkedModuleIds) {
    if (!moduleIds.includes(moduleId)) throw new Error(`Package "${packageName}" is missing source or compiled descriptors for "${moduleId}". No package was installed.`)
    assertModulePackageExports(manifest, packageName, moduleId, files, readSource)
  }
  if (moduleIds.length === 0) throw new Error(`Package "${packageName}" is missing source or compiled module descriptors. Build the package before retrying. No package was installed.`)
  return { moduleIds, ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}) }
}

function inspectArchive(archive: string, packageName: string, requiredModuleIds: readonly string[]): ArtifactInspection {
  const manifest = record(JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8', timeout: 15_000 })))
  const files = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }).split('\n').filter((file) => file.startsWith('package/')).map((file) => file.slice('package/'.length))
  return inspectFiles(manifest, packageName, files, requiredModuleIds, (relativePath) => execFileSync('tar', ['-xOf', archive, `package/${relativePath}`], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 }))
}

function packageFiles(packageRoot: string, relativeDir = ''): string[] {
  return fs.readdirSync(path.join(packageRoot, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const relativePath = path.posix.join(relativeDir, entry.name)
    return entry.isDirectory() ? packageFiles(packageRoot, relativePath) : entry.isFile() ? [relativePath] : []
  })
}

function isModernYarnProject(appDir: string): boolean {
  let directory = appDir
  while (true) {
    if (fs.existsSync(path.join(directory, '.yarnrc.yml'))) return true
    const manifestPath = path.join(directory, 'package.json')
    if (fs.existsSync(manifestPath)) {
      const manifest = record(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
      if (typeof manifest.packageManager === 'string' && /^yarn@(?:[2-9]|[1-9][0-9]+)\./.test(manifest.packageManager)) return true
    }
    const parent = path.dirname(directory)
    if (parent === directory) return false
    directory = parent
  }
}

function yarnNpmConfiguration(appDir: string, packageName: string, temporaryDir: string): string[] {
  if (!isModernYarnProject(appDir)) return []
  const settings = new Map<string, unknown>()
  for (const setting of ['npmRegistryServer', 'npmScopes', 'npmRegistries', 'npmAuthToken', 'npmAuthIdent']) {
    const result = spawn.sync(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', ['config', 'get', setting, '--json', '--no-redacted'], {
      cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
    })
    if (result.error || result.status !== 0) throw new Error('Cannot inspect project package registry configuration')
    settings.set(setting, JSON.parse(result.stdout))
  }
  const scope = packageName.startsWith('@') ? packageName.slice(1).split('/')[0] : undefined
  const scopeSettings = scope ? record(record(settings.get('npmScopes'))[scope]) : {}
  const registry = typeof scopeSettings.npmRegistryServer === 'string' ? scopeSettings.npmRegistryServer : settings.get('npmRegistryServer')
  if (typeof registry !== 'string') throw new Error('Missing project package registry')
  const registryUrl = new URL(registry)
  if (!['http:', 'https:'].includes(registryUrl.protocol) || registryUrl.username || registryUrl.password) throw new Error('Invalid project package registry')
  const registryKey = `//${registryUrl.host}${registryUrl.pathname}`.replace(/\/$/, '')
  const registries = record(settings.get('npmRegistries'))
  const registrySettings = record(registries[registry.replace(/\/$/, '')] ?? registries[registryKey] ?? registries[`${registryKey}/`])
  const auth = scopeSettings.npmAuthToken || scopeSettings.npmAuthIdent ? scopeSettings
    : registrySettings.npmAuthToken || registrySettings.npmAuthIdent ? registrySettings
      : { npmAuthToken: settings.get('npmAuthToken'), npmAuthIdent: settings.get('npmAuthIdent') }
  const userConfig = process.env.NPM_CONFIG_USERCONFIG ?? process.env.npm_config_userconfig ?? path.join(os.homedir(), '.npmrc')
  const existingConfig = fs.existsSync(userConfig) ? fs.readFileSync(userConfig, 'utf8') : ''
  const lines = [existingConfig, `registry=${JSON.stringify(registry)}`]
  if (scope) lines.push(`@${scope}:registry=${JSON.stringify(registry)}`)
  if (typeof auth.npmAuthToken === 'string' && auth.npmAuthToken) lines.push(`${registryKey}/:_authToken=${JSON.stringify(auth.npmAuthToken)}`)
  else if (typeof auth.npmAuthIdent === 'string' && auth.npmAuthIdent) lines.push(`${registryKey}/:_auth=${Buffer.from(auth.npmAuthIdent).toString('base64')}`)
  const configPath = path.join(temporaryDir, 'inspection.npmrc')
  fs.writeFileSync(configPath, `${lines.join('\n')}\n`, { mode: 0o600 })
  return ['--userconfig', configPath, '--registry', registry, ...(scope ? [`--@${scope}:registry=${registry}`] : [])]
}

export function inspectNpmModuleTarget(packageSpec: string, packageName: string, appDir: string, requiredModuleIds: readonly string[] = []): InspectedModuleTarget {
  const filePrefix = `${packageName}@file:`
  if (packageSpec.startsWith(filePrefix)) {
    const packageRoot = path.resolve(appDir, packageSpec.slice(filePrefix.length))
    if (fs.statSync(packageRoot).isFile()) return { packageName, packageSpec, ...inspectArchive(packageRoot, packageName, requiredModuleIds), locator: `npm:${packageName}` }
    const manifest = record(JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')))
    const inspected = inspectFiles(manifest, packageName, packageFiles(packageRoot), requiredModuleIds, (relativePath) => fs.readFileSync(path.join(packageRoot, relativePath), 'utf8'))
    return { packageName, packageSpec, ...inspected, locator: `npm:${packageName}` }
  }

  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-module-inspection-'))
  try {
    const configurationArgs = yarnNpmConfiguration(appDir, packageName, temporaryDir)
    const packedProcess = spawn.sync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', packageSpec, '--ignore-scripts', '--json', '--pack-destination', temporaryDir, ...configurationArgs], {
      cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    })
    if (packedProcess.error || packedProcess.status !== 0) throw new Error('Artifact inspection failed')
    const packages: unknown = JSON.parse(packedProcess.stdout)
    const packed = record(Array.isArray(packages) ? packages[0] : undefined)
    if (packed.name !== packageName || typeof packed.version !== 'string' || !/^[0-9A-Za-z.+-]+$/.test(packed.version)
      || typeof packed.filename !== 'string' || path.basename(packed.filename) !== packed.filename) throw new Error('Invalid packed manifest')
    const inspected = inspectArchive(path.join(temporaryDir, packed.filename), packageName, requiredModuleIds)
    if (inspected.version !== packed.version) throw new Error('Packed artifact version disagrees with resolution')
    return { packageName, packageSpec, ...inspected, locator: `npm:${packageName}` }
  } catch {
    throw new Error(`Cannot inspect the exact module artifact for "${packageName}". Check project registry credentials, package access and shipped src/dist module descriptors before retrying. No package was installed.`)
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true })
  }
}
