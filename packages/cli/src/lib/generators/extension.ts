import type { WriterFunction } from 'ts-morph'
import type { GeneratedImportSpec } from './ast'
import type { ModuleImports, ModuleRoots, resolveFirstModuleFile, resolveModuleFile } from './scanner'

export interface StandaloneConfigOptions {
  roots: ModuleRoots
  imps: ModuleImports
  modId: string
  relativePath: string
  prefix: string
  importIdRef: { value: number }
  standaloneImports: GeneratedImportSpec[] | string[]
  standaloneEntries?: WriterFunction[]
  writeConfig?: (options: { importName: string; moduleId: string }) => WriterFunction
  standaloneConfigs?: string[]
  configExpr?: (importName: string, modId: string) => string
  sharedImports?: GeneratedImportSpec[] | string[]
}

export interface ModuleScanContext {
  moduleId: string
  roots: ModuleRoots
  imps: ModuleImports
  importIdRef: { value: number }
  sharedImports: GeneratedImportSpec[] | string[]
  resolveModuleFile: typeof resolveModuleFile
  resolveFirstModuleFile: typeof resolveFirstModuleFile
  processStandaloneConfig: (options: StandaloneConfigOptions) => string | null
  sanitizeGeneratedModuleSpecifier: (importPath: string) => string
}

export interface GeneratorExtension {
  id: string
  outputFiles: string[]
  scanModule(ctx: ModuleScanContext): void
  generateOutput(): Map<string, string>
  getModuleDeclContribution?(moduleId: string): string | null
}
