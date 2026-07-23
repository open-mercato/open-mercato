import fs from 'node:fs'
import path from 'node:path'
import { purgeConfiguredCachePatternsAcrossTenantScopes } from '@open-mercato/shared/lib/cache/maintenance'

const STRUCTURAL_CACHE_PATTERNS = [
  'nav:*',
  'crud|*|*|*/admin/nav|*',
  'crud|*|*|*/portal/nav|*',
]
const TOUCHABLE_GENERATED_FILE_PATTERN = /\.generated(?:\.[a-z0-9]+)?(?:\.ts|\.checksum)$/i

export type PostGenerateStructuralInvalidationResult = {
  cacheEntriesDeleted: number
  generatedFilesTouched: string[]
  cacheError: unknown | null
  generatedFilesError: unknown | null
}

function touchGeneratedFiles(appDir: string): string[] {
  const generatedDir = path.join(appDir, '.mercato', 'generated')
  if (!fs.existsSync(generatedDir) || !fs.statSync(generatedDir).isDirectory()) return []

  const touched: string[] = []
  const entries = fs.readdirSync(generatedDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    if (!entry.isFile() || !TOUCHABLE_GENERATED_FILE_PATTERN.test(entry.name)) continue
    const filePath = path.join(generatedDir, entry.name)
    const contents = fs.readFileSync(filePath)
    fs.writeFileSync(filePath, contents)
    touched.push(filePath)
  }
  return touched
}

export async function runPostGenerateStructuralInvalidation(
  appDir: string,
): Promise<PostGenerateStructuralInvalidationResult> {
  let cacheEntriesDeleted = 0
  let generatedFilesTouched: string[] = []
  let cacheError: unknown | null = null
  let generatedFilesError: unknown | null = null

  try {
    generatedFilesTouched = touchGeneratedFiles(appDir)
  } catch (error) {
    generatedFilesError = error
  }

  try {
    cacheEntriesDeleted = await purgeConfiguredCachePatternsAcrossTenantScopes(STRUCTURAL_CACHE_PATTERNS)
  } catch (error) {
    cacheError = error
  }

  return {
    cacheEntriesDeleted,
    generatedFilesTouched,
    cacheError,
    generatedFilesError,
  }
}
