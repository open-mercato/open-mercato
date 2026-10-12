import fs from 'node:fs'
import path from 'node:path'
import spawn from 'cross-spawn'
import { copyDirRecursive, rewriteCrossModuleImports } from './eject'
import {
  parsePackageNameFromSpec,
  resolveInstalledOfficialModulePackage,
  validateEjectBoundaries,
  type ValidatedOfficialModulePackage,
} from './module-package'
import { ensureModuleRegistration } from './modules-config'
import type { PackageResolver } from './resolver'
import { resolveSpawnCommand } from './spawn'
import { parseModuleLocator, resolveModuleRequirement } from '@open-mercato/shared/modules/module-locators'
import { getEnabledModuleIdentities, getModuleLocators } from './module-identity'
import { resolveGithubModuleTarget } from './module-github'

type ModuleCommandResult = {
  moduleId: string
  packageName: string
  from: string
  registrationChanged: boolean
}

type InstallTarget = {
  cwd: string
  args: string[]
}

const OFFICIAL_PACKAGE_SCOPE = '@open-mercato/'
const SAFE_PACKAGE_SPEC_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@.+)?$/i
const SAFE_PACKAGE_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_PACKAGE_FILE_LOCATOR_PATTERN = /^file:[A-Za-z0-9_./: \\-]+$/

function resolveYarnBinary(): string {
  return process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
}

function readAppPackageName(appDir: string): string {
  const packageJsonPath = path.join(appDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`App package.json not found at ${packageJsonPath}.`)
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string }
  if (!packageJson.name) {
    throw new Error(`App package.json at ${packageJsonPath} is missing the "name" field.`)
  }

  return packageJson.name
}

function resolveInstallTarget(resolver: PackageResolver): InstallTarget {
  if (!resolver.isMonorepo()) {
    return {
      cwd: resolver.getAppDir(),
      args: ['add'],
    }
  }

  return {
    cwd: resolver.getRootDir(),
    args: ['workspace', readAppPackageName(resolver.getAppDir()), 'add'],
  }
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const resolvedSpawn = resolveSpawnCommand(command, args)
    const child = spawn(resolvedSpawn.command, resolvedSpawn.args, {
      cwd,
      env: process.env,
      stdio: 'inherit',
      ...resolvedSpawn.spawnOptions,
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Command failed: ${command} ${args.join(' ')} (exit ${code ?? 'unknown'}).`))
    })
  })
}

async function installPackageSpec(
  resolver: PackageResolver,
  packageSpec: string,
): Promise<void> {
  const target = resolveInstallTarget(resolver)
  await runCommand(resolveYarnBinary(), [...target.args, packageSpec], target.cwd)
}

export async function runModuleGenerators(
  resolver: PackageResolver,
  quiet = true,
): Promise<void> {
  const {
    generateEntityIds,
    generateModuleDi,
    generateModuleEntities,
    generateModulePackageSources,
    generateModuleRegistries,
    generateOpenApi,
  } = await import('./generators')

  await generateEntityIds({ resolver, quiet })
  await generateModuleRegistries({ resolver, quiet })
  await generateModuleEntities({ resolver, quiet })
  await generateModuleDi({ resolver, quiet })
  await generateModulePackageSources({ resolver, quiet })
  await generateOpenApi({ resolver, quiet })
}

async function runGeneratorsWithRegistrationNotice(
  resolver: PackageResolver,
  moduleId: string,
): Promise<void> {
  try {
    await runModuleGenerators(resolver)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Module "${moduleId}" is enabled, but generated artifacts are stale because generation failed. Rerun "yarn mercato generate" after fixing the underlying error. ${message}`,
    )
  }
}

function isOfficialPackage(packageName: string): boolean {
  return packageName.startsWith(OFFICIAL_PACKAGE_SCOPE)
}

function assertPackageName(packageName: string | null): asserts packageName is string {
  if (!packageName) {
    throw new Error('Could not determine a package name from the provided spec.')
  }
}

function assertThirdPartyAllowed(packageName: string, allowThirdParty: boolean): void {
  if (isOfficialPackage(packageName) || allowThirdParty) {
    return
  }

  throw new Error(
    `Package "${packageName}" is outside the ${OFFICIAL_PACKAGE_SCOPE}* scope. Re-run with --allow-third-party to install third-party module packages.`,
  )
}

function assertSupportedPackageSpec(packageSpec: string, allowThirdParty: boolean): string {
  const trimmed = packageSpec.trim().replace(/^npm:/, '')

  if (!SAFE_PACKAGE_SPEC_PATTERN.test(trimmed)) {
    throw new Error('Unsupported package spec. Provide a valid npm package name with an optional tag/version or file: locator.')
  }

  const packageName = parsePackageNameFromSpec(trimmed)
  assertPackageName(packageName)
  assertThirdPartyAllowed(packageName, allowThirdParty)

  if (trimmed === packageName) {
    return trimmed
  }

  const suffix = trimmed.slice(packageName.length + 1)
  if (SAFE_PACKAGE_TAG_PATTERN.test(suffix) || SAFE_PACKAGE_FILE_LOCATOR_PATTERN.test(suffix)) {
    return trimmed
  }

  throw new Error('Unsupported package spec suffix. Use a tag/version token or a file: locator.')
}

function validateBeforeRegistration(
  modulePackage: ValidatedOfficialModulePackage,
  resolver: PackageResolver,
  eject: boolean,
): string {
  const appModuleDir = path.join(resolver.getAppDir(), 'src', 'modules', modulePackage.metadata.moduleId)

  if (eject && fs.existsSync(appModuleDir)) {
    throw new Error(`Destination directory already exists: ${appModuleDir}. Remove it first or rerun without --eject.`)
  }

  return appModuleDir
}

function assertRequiredModulesEnabled(
  modulePackage: ValidatedOfficialModulePackage,
  resolver: PackageResolver,
): void {
  const enabledModules = getEnabledModuleIdentities(resolver)
  const missingModuleIds = Array.from(new Set(modulePackage.moduleInfo.requires ?? [])).filter(
    (requirement) => !resolveModuleRequirement(requirement, enabledModules),
  )
  if (missingModuleIds.length === 0) return

  throw new Error(
    [
      `Module "${modulePackage.metadata.moduleId}" requires module(s) that are not enabled: ${missingModuleIds.join(', ')}.`,
      'Enable the missing module(s) in src/modules.ts first, then rerun this command.',
      ...missingModuleIds.filter((requirement) => parseModuleLocator(requirement)?.kind !== 'module').map(
        (requirement) => `Install ${requirement}: npx create-mercato-module install ${shellQuote(requirement)}`,
      ),
    ].join('\n'),
  )
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

function assertNoModuleCollision(
  resolver: PackageResolver,
  moduleId: string,
  packageName: string,
  locator?: string,
): void {
  const existing = resolver.loadEnabledModules().find((entry) => entry.id === moduleId)
  if (existing && (existing.from ?? '@open-mercato/core') !== packageName) {
    throw new Error(`Module name collision: "${moduleId}" is already registered from "${existing.locator ?? existing.from ?? '@open-mercato/core'}"; requested source is "${locator ?? packageName}". Two sources cannot share one module id. Remove or rename the conflicting module explicitly before retrying.`)
  }
  const existingGithub = existing ? getModuleLocators(existing, resolver).find((value) => value.startsWith('github:')) : undefined
  const requestedIdentity = locator ? parseModuleLocator(locator)?.identity : undefined
  if (existingGithub && requestedIdentity?.startsWith('github:') && existingGithub !== requestedIdentity) {
    throw new Error(`Module name collision: "${moduleId}" is already registered from "${existingGithub}"; requested source is "${locator}". Remove or rename the conflicting module explicitly before retrying.`)
  }
  if (fs.existsSync(path.join(resolver.getAppDir(), 'src', 'modules', moduleId))) {
    throw new Error(`Module name collision: local src/modules/${moduleId} already exists; requested source is "${locator ?? packageName}". Remove or rename the conflicting module explicitly before retrying.`)
  }
}

function prepareRegistrationSource(
  modulePackage: ValidatedOfficialModulePackage,
  resolver: PackageResolver,
  packageName: string,
  eject: boolean,
): string {
  const appModuleDir = validateBeforeRegistration(modulePackage, resolver, eject)

  if (!eject) {
    return packageName
  }

  if (!modulePackage.metadata.ejectable) {
    throw new Error(`Package "${packageName}" is not ejectable. --eject requires open-mercato.ejectable === true.`)
  }

  validateEjectBoundaries(modulePackage)
  copyDirRecursive(modulePackage.sourceModuleDir, appModuleDir)
  rewriteCrossModuleImports(
    modulePackage.sourceModuleDir,
    appModuleDir,
    modulePackage.metadata.moduleId,
    packageName,
  )

  return '@app'
}

async function registerResolvedOfficialModule(
  resolver: PackageResolver,
  modulePackage: ValidatedOfficialModulePackage,
  packageName: string,
  eject: boolean,
): Promise<ModuleCommandResult> {
  const locators = getModuleLocators({ id: modulePackage.metadata.moduleId, from: packageName }, resolver)
  const locator = locators.find((value) => value.startsWith('github:')) ?? `npm:${packageName}`
  assertNoModuleCollision(resolver, modulePackage.metadata.moduleId, packageName, locator)
  assertRequiredModulesEnabled(modulePackage, resolver)
  const from = prepareRegistrationSource(modulePackage, resolver, packageName, eject)

  const registration = ensureModuleRegistration(
    resolver.getModulesConfigPath(),
    {
      id: modulePackage.metadata.moduleId,
      from,
      ...(eject || locator.startsWith('github:') ? { locator } : {}),
      ...(eject ? { packageName } : {}),
    },
  )

  if (!registration.changed) {
    throw new Error(
      `Module "${modulePackage.metadata.moduleId}" from "${from}" is already enabled in modules.ts.`,
    )
  }

  await runGeneratorsWithRegistrationNotice(resolver, modulePackage.metadata.moduleId)

  return {
    moduleId: modulePackage.metadata.moduleId,
    packageName,
    from,
    registrationChanged: registration.changed,
  }
}

export async function addOfficialModule(
  resolver: PackageResolver,
  packageSpec: string,
  eject: boolean,
  moduleId?: string,
  allowThirdParty = false,
): Promise<ModuleCommandResult> {
  const input = packageSpec.trim()
  const isGithub = !input.startsWith('@') && !input.startsWith('npm:') && (
    input.includes('/') && !input.includes('@file:') || /^(?:github:|git@|(?:git\+)?ssh:)/i.test(input)
  )
  let safePackageSpec: string
  let packageName: string
  if (isGithub) {
    if (!allowThirdParty) {
      throw new Error('GitHub repository installs require --allow-third-party, independently of the declared npm package scope.')
    }
    const target = resolveGithubModuleTarget(input, resolver.getAppDir())
    assertThirdPartyAllowed(target.packageName, allowThirdParty)
    const selectedModuleId = moduleId ?? (target.moduleIds.length === 1 ? target.moduleIds[0] : undefined)
    if (!selectedModuleId || !target.moduleIds.includes(selectedModuleId)) {
      throw new Error(`Select a module with --module <moduleId>. Available in ${target.locator}: ${target.moduleIds.join(', ')}. No package was installed.`)
    }
    assertNoModuleCollision(resolver, selectedModuleId, target.packageName, target.locator)
    safePackageSpec = target.packageSpec
    packageName = target.packageName
  } else {
    safePackageSpec = assertSupportedPackageSpec(input, allowThirdParty)
    const parsedName = parsePackageNameFromSpec(safePackageSpec)
    assertPackageName(parsedName)
    packageName = parsedName
    if (moduleId) assertNoModuleCollision(resolver, moduleId, packageName, `npm:${packageName}`)
  }
  await installPackageSpec(resolver, safePackageSpec)

  const modulePackage = resolveInstalledOfficialModulePackage(resolver, packageName, moduleId)
  return registerResolvedOfficialModule(resolver, modulePackage, packageName, eject)
}

export async function enableOfficialModule(
  resolver: PackageResolver,
  packageName: string,
  moduleId?: string,
  eject = false,
  allowThirdParty = false,
): Promise<ModuleCommandResult> {
  assertThirdPartyAllowed(packageName, allowThirdParty)

  const modulePackage = resolveInstalledOfficialModulePackage(resolver, packageName, moduleId)
  return registerResolvedOfficialModule(resolver, modulePackage, packageName, eject)
}
