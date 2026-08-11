import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export function synchronizeDirectory(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true })

  const sourceEntries = new Set(readdirSync(sourceDir))
  for (const sourceEntry of sourceEntries) {
    const sourcePath = join(sourceDir, sourceEntry)
    const targetPath = join(targetDir, sourceEntry)
    const sourceIsDirectory = statSync(sourcePath).isDirectory()
    const targetIsDirectory = existsSync(targetPath) && statSync(targetPath).isDirectory()

    if (existsSync(targetPath) && sourceIsDirectory !== targetIsDirectory) {
      rmSync(targetPath, { recursive: true, force: true })
    }

    if (sourceIsDirectory) {
      synchronizeDirectory(sourcePath, targetPath)
    } else {
      cpSync(sourcePath, targetPath, { force: true })
    }
  }

  for (const targetEntry of readdirSync(targetDir)) {
    if (!sourceEntries.has(targetEntry)) {
      rmSync(join(targetDir, targetEntry), { recursive: true, force: true })
    }
  }
}
