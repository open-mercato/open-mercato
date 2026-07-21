import fs from 'node:fs'
import path from 'node:path'
import type { GenerateWatcherChangeSignal } from './in-process-generate-watcher'

export type GenerateWatchTarget = {
  directory: string
  recursive: boolean
  fileName?: string
}

type WatchHandle = {
  close(): void
}

type WatchDirectory = (
  target: GenerateWatchTarget,
  onChange: (fileName?: string) => void,
  onError: () => void,
) => WatchHandle

export type GenerateWatchChangeSignalOptions = {
  getWatchTargets: () => Promise<GenerateWatchTarget[]> | GenerateWatchTarget[]
  watchDirectory?: WatchDirectory
}

function targetKey(target: GenerateWatchTarget): string {
  return JSON.stringify([
    path.resolve(target.directory),
    target.recursive,
    target.fileName ?? '',
  ])
}

const defaultWatchDirectory: WatchDirectory = (target, onChange, onError) => {
  const watcher = fs.watch(
    target.directory,
    { recursive: target.recursive },
    (_eventType, fileName) => {
      const normalizedName = String(fileName ?? '')
      if (target.fileName && normalizedName && normalizedName !== target.fileName) return
      onChange(normalizedName || undefined)
    },
  )
  watcher.on('error', onError)
  return watcher
}

export function createGenerateWatchChangeSignal(
  options: GenerateWatchChangeSignalOptions,
): GenerateWatcherChangeSignal {
  const watchDirectory = options.watchDirectory ?? defaultWatchDirectory
  const watchers = new Map<string, WatchHandle>()
  let version = 0
  let pollingFallback = false
  let closed = false

  const closeWatchers = () => {
    for (const watcher of watchers.values()) {
      try { watcher.close() } catch {}
    }
    watchers.clear()
  }

  const enterPollingFallback = () => {
    if (pollingFallback) return
    pollingFallback = true
    version += 1
    closeWatchers()
  }

  return {
    currentVersion: () => version,
    usesPollingFallback: () => pollingFallback,
    refresh: async () => {
      if (closed || pollingFallback) return

      let targets: GenerateWatchTarget[]
      try {
        targets = await options.getWatchTargets()
      } catch {
        enterPollingFallback()
        return
      }

      const normalizedTargets = new Map<string, GenerateWatchTarget>()
      for (const target of targets) {
        const normalized: GenerateWatchTarget = {
          ...target,
          directory: path.resolve(target.directory),
        }
        normalizedTargets.set(targetKey(normalized), normalized)
      }

      for (const [key, watcher] of watchers) {
        if (normalizedTargets.has(key)) continue
        try { watcher.close() } catch {}
        watchers.delete(key)
      }

      for (const [key, target] of normalizedTargets) {
        if (watchers.has(key)) continue
        try {
          const watcher = watchDirectory(
            target,
            () => { version += 1 },
            enterPollingFallback,
          )
          if (closed || pollingFallback) {
            try { watcher.close() } catch {}
            continue
          }
          watchers.set(key, watcher)
        } catch {
          enterPollingFallback()
          return
        }
      }
    },
    close: () => {
      if (closed) return
      closed = true
      closeWatchers()
    },
  }
}
