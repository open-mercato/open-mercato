import fs from 'node:fs'
import path from 'node:path'
import type { GenerateWatcherChangeSignal } from './in-process-generate-watcher'
import type { GenerateWatchSnapshot } from './generate-watch-plan'

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
  directoryExists?: (directory: string) => boolean
  onSkippedDirectory?: (directory: string) => void
}

export type GenerateWatchModuleTarget = {
  appBase: string
  pkgBase: string
  watchPackageBase: boolean
  /** Both installed source/runtime roots, including roots not present yet. */
  additionalModuleBases?: readonly string[]
}

export function resolveGenerateWatchTargets(options: {
  modulesFile: string
  moduleRoots: GenerateWatchModuleTarget[]
  resolveSourceMirrorBase: (packageBase: string) => string | null
  additionalInputs?: readonly string[]
  additionalDirectories?: readonly string[]
  appSourceDir?: string
  outputDir?: string
  snapshot?: GenerateWatchSnapshot
}): GenerateWatchTarget[] {
  const targets: GenerateWatchTarget[] = [options.modulesFile, ...(options.additionalInputs ?? [])].map((filePath) => ({
    directory: path.dirname(filePath),
    recursive: false,
    fileName: path.basename(filePath),
  }))
  if (options.appSourceDir) targets.push({ directory: options.appSourceDir, recursive: true })
  for (const directory of options.additionalDirectories ?? []) {
    targets.push({ directory, recursive: false })
  }

  for (const roots of options.moduleRoots) {
    targets.push({ directory: path.dirname(roots.appBase), recursive: true })
    if (!roots.watchPackageBase) continue

    targets.push({ directory: path.dirname(roots.pkgBase), recursive: true })
    for (const base of roots.additionalModuleBases ?? []) {
      targets.push({ directory: path.dirname(base), recursive: true })
    }
    const distMarker = `${path.sep}dist${path.sep}modules${path.sep}`
    const distIndex = roots.pkgBase.lastIndexOf(distMarker)
    const sourceMirror = options.resolveSourceMirrorBase(roots.pkgBase)
      ?? (distIndex < 0 ? null : `${roots.pkgBase.slice(0, distIndex)}${path.sep}src${path.sep}modules${path.sep}${roots.pkgBase.slice(distIndex + distMarker.length)}`)
    if (sourceMirror) {
      targets.push({ directory: path.dirname(sourceMirror), recursive: true })
    }
  }

  // Snapshot dependencies can live outside module roots. Subscribe to only the
  // discovered paths; never recursively watch an entire package to cover them.
  const recursiveRoots = targets.filter((target) => target.recursive).map((target) => path.resolve(target.directory))
  const outputRoot = options.outputDir ? path.resolve(options.outputDir) : undefined
  const seenInputs = new Set<string>()
  for (const record of options.snapshot?.records.values() ?? []) {
    const input = path.resolve(record.path)
    if (seenInputs.has(input)) continue
    seenInputs.add(input)
    if (outputRoot && (input === outputRoot || input.startsWith(`${outputRoot}${path.sep}`))) continue
    if (recursiveRoots.some((root) => input === root || input.startsWith(`${root}${path.sep}`))) continue
    let stat: fs.Stats | undefined
    try { stat = fs.statSync(input) } catch {}
    if (stat?.isDirectory()) {
      targets.push({ directory: input, recursive: true })
      recursiveRoots.push(input)
      continue
    }
    const parent = path.dirname(input)
    targets.push({
      directory: parent,
      recursive: false,
      // A missing extensionless import can become foo.ts or foo/index.ts.
      ...(!stat && !path.extname(input) ? {} : { fileName: path.basename(input) }),
    })
    if (!fs.existsSync(parent)) {
      let ancestor = path.dirname(parent)
      while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor)
      targets.push({ directory: ancestor, recursive: false })
    }
  }

  return targets
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
  const directoryExists = options.directoryExists ?? fs.existsSync
  const watchers = new Map<string, WatchHandle>()
  let skippedDirectories = new Set<string>()
  let version = 0
  let pollingFallback = false
  let closed = false
  let lastUnknownVersion = -1
  let initialized = false

  const closeWatchers = () => {
    for (const watcher of watchers.values()) {
      try { watcher.close() } catch {}
    }
    watchers.clear()
  }

  const enterPollingFallback = () => {
    if (closed || pollingFallback) return
    pollingFallback = true
    version += 1
    closeWatchers()
  }

  return {
    currentVersion: () => version,
    fullGenerationReasonSince: (capturedVersion) => lastUnknownVersion > capturedVersion
      ? 'filesystem event did not identify a path'
      : undefined,
    hasSkippedTargets: () => skippedDirectories.size > 0,
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
      if (closed || pollingFallback) return

      const normalizedTargets = new Map<string, GenerateWatchTarget>()
      const nextSkippedDirectories = new Set<string>()
      for (const target of targets) {
        const normalized: GenerateWatchTarget = {
          ...target,
          directory: path.resolve(target.directory),
        }
        if (!directoryExists(normalized.directory)) {
          nextSkippedDirectories.add(normalized.directory)
          if (!skippedDirectories.has(normalized.directory)) {
            try { options.onSkippedDirectory?.(normalized.directory) } catch {}
          }
          continue
        }
        normalizedTargets.set(targetKey(normalized), normalized)
      }
      skippedDirectories = nextSkippedDirectories

      for (const [key, watcher] of watchers) {
        if (normalizedTargets.has(key)) continue
        try { watcher.close() } catch {}
        watchers.delete(key)
        version += 1
      }

      for (const [key, target] of normalizedTargets) {
        if (watchers.has(key)) continue
        try {
          const watcher = watchDirectory(
            target,
            (fileName) => {
              if (closed || pollingFallback) return
              version += 1
              if (!fileName) lastUnknownVersion = version
            },
            enterPollingFallback,
          )
          if (closed || pollingFallback) {
            try { watcher.close() } catch {}
            continue
          }
          watchers.set(key, watcher)
          if (initialized) version += 1
        } catch {
          enterPollingFallback()
          return
        }
      }
      initialized = true
    },
    close: () => {
      if (closed) return
      closed = true
      closeWatchers()
    },
  }
}
