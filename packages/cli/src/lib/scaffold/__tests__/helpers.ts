import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PackageResolver, ModuleEntry } from '../../resolver'
import { runModuleScaffold } from '../index'

export function createTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-test-'))
}

export function createMockResolver(rootDir: string): PackageResolver {
  return {
    isMonorepo: () => true,
    getRootDir: () => rootDir,
    getAppDir: () => path.join(rootDir, 'apps', 'mercato'),
    getOutputDir: () => path.join(rootDir, 'apps', 'mercato', '.mercato', 'generated'),
    getModulesConfigPath: () => path.join(rootDir, 'apps', 'mercato', 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => [],
    getModulePaths: (entry: ModuleEntry) => ({
      appBase: path.join(rootDir, 'apps', 'mercato', 'src', 'modules', entry.id),
      pkgBase: path.join(rootDir, 'packages', 'core', 'src', 'modules', entry.id),
    }),
    getModuleImportBase: (entry: ModuleEntry) => ({
      appBase: `@/modules/${entry.id}`,
      pkgBase: `@open-mercato/core/modules/${entry.id}`,
    }),
    getPackageOutputDir: () => path.join(rootDir, 'apps', 'mercato', '.mercato', 'generated'),
    getPackageRoot: () => path.join(rootDir, 'packages', 'core'),
  }
}

export type CapturedRun = {
  code: number
  logs: string[]
  errors: string[]
  output: string
}

export async function runScaffold(rootDir: string, args: string[]): Promise<CapturedRun> {
  const logs: string[] = []
  const errors: string[] = []
  const code = await runModuleScaffold(args, {
    resolver: createMockResolver(rootDir),
    logger: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
  })
  return { code, logs, errors, output: [...logs, ...errors].join('\n') }
}

/** Recursively read every file under `dir` into a sorted relPath → contents map. */
export function readTree(dir: string): Map<string, string> {
  const files = new Map<string, string>()
  if (!fs.existsSync(dir)) return files
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absPath = path.join(current, entry.name)
      if (entry.isDirectory()) walk(absPath)
      else files.set(path.relative(dir, absPath).split(path.sep).join('/'), fs.readFileSync(absPath, 'utf8'))
    }
  }
  walk(dir)
  return files
}

/** Every field type + both required shapes + status and non-status selects. */
export const FULL_FIELDS =
  'name:text:required,summary:textarea,quantity:number:required,status:select(open|in_progress|closed),severity:select(low|high):required,archived:checkbox,dueDate:date:required'

export const FULL_ARGS = ['inventory_items', '--entity', 'stock_item', '--fields', FULL_FIELDS, '--with-ui']
