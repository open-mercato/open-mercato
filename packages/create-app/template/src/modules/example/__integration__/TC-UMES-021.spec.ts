import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

type ProjectContext = {
  appRoot: string
  commandCwd: string
  mercatoBin?: string
  useSourceCli: boolean
}

type CommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type OverrideTarget = {
  appImport: string
  moduleDir: string
  moduleId: string
  packageImport: string
}

const packageOverrideCandidates = ['customers', 'catalog', 'sales', 'auth'] as const

function resolveProjectContext(): ProjectContext {
  let directory = process.cwd()

  for (let depth = 0; depth < 10; depth += 1) {
    const monorepoAppRoot = path.join(directory, 'apps', 'mercato')
    if (
      fs.existsSync(path.join(directory, 'turbo.json'))
      && fs.existsSync(path.join(monorepoAppRoot, 'src', 'modules.ts'))
    ) {
      return {
        appRoot: monorepoAppRoot,
        commandCwd: directory,
        useSourceCli: true,
      }
    }

    if (
      fs.existsSync(path.join(directory, 'package.json'))
      && fs.existsSync(path.join(directory, 'src', 'modules.ts'))
    ) {
      return {
        appRoot: directory,
        commandCwd: directory,
        mercatoBin: resolveMercatoBin([directory]),
        useSourceCli: false,
      }
    }

    const parentDirectory = path.dirname(directory)
    if (parentDirectory === directory) {
      break
    }
    directory = parentDirectory
  }

  throw new Error(`Could not resolve project context from ${process.cwd()}`)
}

function resolveMercatoBin(baseDirectories: string[]): string {
  const candidates = Array.from(new Set(baseDirectories.flatMap((baseDirectory) => [
    path.join(baseDirectory, 'node_modules', '.bin', 'mercato'),
    path.join(baseDirectory, 'node_modules', '@open-mercato', 'cli', 'bin', 'mercato'),
    path.join(baseDirectory, 'packages', 'cli', 'bin', 'mercato'),
  ])))

  const match = candidates.find((candidate) => fs.existsSync(candidate))
  if (!match) {
    throw new Error(`Could not find mercato bin. Checked: ${candidates.join(', ')}`)
  }

  return match
}

function runMercato(context: ProjectContext, args: string[]): CommandResult {
  const command = context.useSourceCli ? 'yarn' : context.mercatoBin
  const commandArgs = context.useSourceCli
    ? ['tsx', 'packages/cli/src/bin.ts', ...args]
    : args

  const result = spawnSync(command, commandArgs, {
    cwd: context.commandCwd,
    encoding: 'utf-8',
    timeout: 15_000,
    env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
  })

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function expectCommandSucceeded(result: CommandResult, args: string[]): void {
  expect(
    result.exitCode,
    [
      `mercato ${args.join(' ')} failed`,
      result.stdout && `stdout:\n${result.stdout.trimEnd()}`,
      result.stderr && `stderr:\n${result.stderr.trimEnd()}`,
    ].filter(Boolean).join('\n\n'),
  ).toBe(0)
}

function readGeneratedDi(appRoot: string): string {
  return fs.readFileSync(path.join(appRoot, '.mercato', 'generated', 'di.generated.ts'), 'utf8')
}

function selectOverrideTarget(appRoot: string, diOutput: string): OverrideTarget {
  for (const moduleId of packageOverrideCandidates) {
    const moduleDir = path.join(appRoot, 'src', 'modules', moduleId)
    const packageImport = `@open-mercato/core/modules/${moduleId}/di`
    if (fs.existsSync(moduleDir)) {
      continue
    }
    if (!diOutput.includes(`from "${packageImport}"`)) {
      continue
    }
    return {
      appImport: `@/modules/${moduleId}/di`,
      moduleDir,
      moduleId,
      packageImport,
    }
  }

  throw new Error(`Could not find a package-backed DI module without an app override in ${appRoot}`)
}

test.describe('TC-UMES-021: DI generator parity', () => {
  test('mercato generate di keeps app imports relative and prefers app overrides over package registrars', () => {
    const context = resolveProjectContext()
    const generateArgs = ['generate', 'di', '--quiet']

    const baselineResult = runMercato(context, generateArgs)
    expectCommandSucceeded(baselineResult, generateArgs)

    const baselineOutput = readGeneratedDi(context.appRoot)
    expect(baselineOutput).toContain('from "../../src/modules/example/di"')

    const overrideTarget = selectOverrideTarget(context.appRoot, baselineOutput)
    expect(baselineOutput).toContain(`from "${overrideTarget.packageImport}"`)
    expect(baselineOutput).not.toContain(`from "${overrideTarget.appImport}"`)

    try {
      fs.mkdirSync(overrideTarget.moduleDir, { recursive: true })
      fs.writeFileSync(path.join(overrideTarget.moduleDir, 'di.ts'), 'export function register() {}\n')

      const overrideResult = runMercato(context, generateArgs)
      expectCommandSucceeded(overrideResult, generateArgs)

      const overrideOutput = readGeneratedDi(context.appRoot)
      expect(overrideOutput).toContain('from "../../src/modules/example/di"')
      expect(overrideOutput).toContain(`from "${overrideTarget.appImport}"`)
      expect(overrideOutput).not.toContain(`from "${overrideTarget.packageImport}"`)

      fs.rmSync(overrideTarget.moduleDir, { recursive: true, force: true })

      const restoreResult = runMercato(context, generateArgs)
      expectCommandSucceeded(restoreResult, generateArgs)

      const restoredOutput = readGeneratedDi(context.appRoot)
      expect(restoredOutput).toContain(`from "${overrideTarget.packageImport}"`)
      expect(restoredOutput).not.toContain(`from "${overrideTarget.appImport}"`)
    } finally {
      fs.rmSync(overrideTarget.moduleDir, { recursive: true, force: true })
      runMercato(context, generateArgs)
    }
  })
})
