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

const SAFE_PACKAGE_SPEC_PATTERN = /^@open-mercato\/[a-z0-9][a-z0-9-]*(?:@.+)?$/i
const SAFE_PACKAGE_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_PACKAGE_FILE_LOCATOR_PATTERN = /^file:[A-Za-z0-9_./:\\-]+$/

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
    generateModuleRegistry,
    generateModuleRegistryApp,
    generateModuleRegistryCli,
    generateOpenApi,
  } = await import('./generators')

  await generateEntityIds({ resolver, quiet })
  await generateModuleRegistry({ resolver, quiet })
  await generateModuleRegistryApp({ resolver, quiet })
  await generateModuleRegistryCli({ resolver, quiet })
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

function assertPackageName(packageName: string | null): asserts packageName is string {
  if (!packageName || !packageName.startsWith('@open-mercato/')) {
    throw new Error('Only @open-mercato/* package specs are supported by "mercato module add".')
  }
}

function assertSupportedPackageSpec(packageSpec: string): string {
  const trimmed = packageSpec.trim()

  if (!SAFE_PACKAGE_SPEC_PATTERN.test(trimmed)) {
    throw new Error('Unsupported package spec. Only direct @open-mercato/* package specs are allowed.')
  }

  const packageName = parsePackageNameFromSpec(trimmed)
  assertPackageName(packageName)

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
  const from = prepareRegistrationSource(modulePackage, resolver, packageName, eject)

  const registration = ensureModuleRegistration(
    resolver.getModulesConfigPath(),
    {
      id: modulePackage.metadata.moduleId,
      from,
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
): Promise<ModuleCommandResult> {
  const safePackageSpec = assertSupportedPackageSpec(packageSpec)
  const packageName = parsePackageNameFromSpec(safePackageSpec)
  assertPackageName(packageName)

  await installPackageSpec(resolver, safePackageSpec)

  const modulePackage = resolveInstalledOfficialModulePackage(resolver, packageName, moduleId)
  return registerResolvedOfficialModule(resolver, modulePackage, packageName, eject)
}

export async function enableOfficialModule(
  resolver: PackageResolver,
  packageName: string,
  moduleId?: string,
  eject = false,
): Promise<ModuleCommandResult> {
  if (!packageName.startsWith('@open-mercato/')) {
    throw new Error('Only @open-mercato/* packages can be enabled with "mercato module enable".')
  }

  const modulePackage = resolveInstalledOfficialModulePackage(resolver, packageName, moduleId)
  return registerResolvedOfficialModule(resolver, modulePackage, packageName, eject)
}
