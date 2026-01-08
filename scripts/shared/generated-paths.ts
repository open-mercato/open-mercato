import path from 'node:path'
import fs from 'node:fs'

const GENERATED_PKG_DIR = 'packages/generated'
const GEN_DIR = '.gen'

export const GENERATED_PKG_PATH = path.resolve(GENERATED_PKG_DIR)
export const GEN_PATH = path.join(GENERATED_PKG_PATH, GEN_DIR)

export function getGeneratedPath(filename: string): string {
  return path.join(GEN_PATH, filename)
}

export function getModulesDir(): string {
  return path.join(GEN_PATH, 'modules')
}

export function ensureGenDir(): void {
  if (!fs.existsSync(GEN_PATH)) {
    fs.mkdirSync(GEN_PATH, { recursive: true })
  }
}

export function ensureModulesDir(): void {
  ensureGenDir()
  const modulesDir = getModulesDir()
  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(modulesDir, { recursive: true })
  }
}

export { GEN_DIR }
