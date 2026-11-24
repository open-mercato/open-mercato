import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const repoRoot = path.resolve(appRoot, '../..')

export const SPECIFIER_ALIASES = {
  '#generated/entities.ids.generated': path.join(repoRoot, 'packages/ui/.storybook/fixtures/entity-ids.ts'),
}

const EXTENSIONS = ['', '.tsx', '.ts', '/index.tsx', '/index.ts']

export function resolveWorkspaceSource(specifier) {
  if (!specifier.startsWith('@open-mercato/')) return null
  const [, packageName, ...parts] = specifier.split('/')
  const target = path.join(repoRoot, 'packages', packageName, 'src', ...parts)
  for (const suffix of EXTENSIONS) {
    const candidate = `${target}${suffix}`
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}
