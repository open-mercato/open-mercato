import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

const DEV_ENV_PRIORITY = [
  '.env',
  '.env.development',
  '.env.local',
  '.env.development.local',
] as const

export type DevEnvReloader = {
  reload: () => void
  getWatchedFiles: () => string[]
}

export function resolveDevEnvFilePaths(appDir: string): string[] {
  return DEV_ENV_PRIORITY.map((fileName) => path.join(appDir, fileName))
}

export function createDevEnvReloader(
  appDir: string,
  environment: NodeJS.ProcessEnv = process.env,
  baseEnvironmentEntries: Iterable<[string, string | undefined]> = Object.entries(environment),
): DevEnvReloader {
  const baseEnvironment = new Map<string, string | undefined>(
    Array.from(baseEnvironmentEntries, ([key, value]) => [key, value]),
  )
  const managedKeys = new Set<string>()
  const envFilePaths = resolveDevEnvFilePaths(appDir)

  const resetManagedKeys = () => {
    for (const key of managedKeys) {
      const baseValue = baseEnvironment.get(key)
      if (baseValue === undefined) {
        delete environment[key]
      } else {
        environment[key] = baseValue
      }
    }
    managedKeys.clear()
  }

  const reload = () => {
    resetManagedKeys()

    for (const envFilePath of envFilePaths) {
      if (!fs.existsSync(envFilePath)) continue

      const parsed = dotenv.parse(fs.readFileSync(envFilePath))
      for (const [key, value] of Object.entries(parsed)) {
        if (baseEnvironment.has(key) && baseEnvironment.get(key) !== undefined) {
          continue
        }
        environment[key] = value
        managedKeys.add(key)
      }
    }
  }

  return {
    reload,
    getWatchedFiles: () => [...envFilePaths],
  }
}

export function watchDevEnvFiles(
  appDir: string,
  onChange: (filePath: string) => void,
  options: { debounceMs?: number } = {},
): () => void {
  const debounceMs = options.debounceMs ?? 250
  const envFilePaths = resolveDevEnvFilePaths(appDir)
  const timers = new Map<string, NodeJS.Timeout>()
  const watchers = envFilePaths.map((envFilePath) => {
    const watchDir = path.dirname(envFilePath)
    const watchFileName = path.basename(envFilePath)

    if (!fs.existsSync(watchDir)) return null

    try {
      return fs.watch(watchDir, (eventType, fileName) => {
        if (eventType !== 'change' && eventType !== 'rename') return
        if (String(fileName ?? '') !== watchFileName) return

        const existingTimer = timers.get(envFilePath)
        if (existingTimer) {
          clearTimeout(existingTimer)
        }

        timers.set(envFilePath, setTimeout(() => {
          timers.delete(envFilePath)
          onChange(envFilePath)
        }, debounceMs))
      })
    } catch {
      return null
    }
  }).filter((watcher): watcher is fs.FSWatcher => watcher !== null)

  return () => {
    for (const timer of timers.values()) {
      clearTimeout(timer)
    }
    timers.clear()
    for (const watcher of watchers) {
      watcher.close()
    }
  }
}
