import path from 'node:path'
import fs from 'node:fs'

export interface AppRoot {
  appDir: string
  mercatoDir: string
  generatedDir: string
}

/**
 * Find the Next.js app root by searching for next.config.ts/js/mjs.
 *
 * Starts from the given directory (defaults to cwd) and walks up the
 * directory tree until it finds a Next.js config file with a .mercato/generated
 * directory.
 *
 * @param startDir - Directory to start searching from (defaults to process.cwd())
 * @returns The resolved app root paths, or null if not found
 */
export function findAppRoot(startDir: string = process.cwd()): AppRoot | null {
  let current = startDir

  while (current !== path.dirname(current)) {
    const configTs = path.join(current, 'next.config.ts')
    const configJs = path.join(current, 'next.config.js')
    const configMjs = path.join(current, 'next.config.mjs')

    if (fs.existsSync(configTs) || fs.existsSync(configJs) || fs.existsSync(configMjs)) {
      const mercatoDir = path.join(current, '.mercato')
      const generatedDir = path.join(mercatoDir, 'generated')

      // Only return if .mercato/generated exists
      if (fs.existsSync(generatedDir)) {
        return { appDir: current, mercatoDir, generatedDir }
      }

      // Found Next.js config but no .mercato/generated - return anyway for generate command
      // The caller can decide whether to create the directory
      return { appDir: current, mercatoDir, generatedDir }
    }

    current = path.dirname(current)
  }

  return null
}

/**
 * Find all apps with .mercato directories in a monorepo.
 *
 * Scans the apps/ directory for Next.js apps with .mercato/generated directories.
 *
 * @param rootDir - The monorepo root directory
 * @returns Array of app root paths
 */
export function findAllApps(rootDir: string): AppRoot[] {
  const appsDir = path.join(rootDir, 'apps')
  if (!fs.existsSync(appsDir)) return []

  const apps: AppRoot[] = []
  const entries = fs.readdirSync(appsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const appDir = path.join(appsDir, entry.name)

    // Check for Next.js config
    const hasNextConfig =
      fs.existsSync(path.join(appDir, 'next.config.ts')) ||
      fs.existsSync(path.join(appDir, 'next.config.js')) ||
      fs.existsSync(path.join(appDir, 'next.config.mjs'))

    if (!hasNextConfig) continue

    const mercatoDir = path.join(appDir, '.mercato')
    const generatedDir = path.join(mercatoDir, 'generated')

    if (fs.existsSync(generatedDir)) {
      apps.push({ appDir, mercatoDir, generatedDir })
    }
  }

  return apps
}
