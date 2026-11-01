import fs from 'node:fs'
import path from 'node:path'
import type { GenerateWatcherChangeSignal } from './in-process-generate-watcher'
import type { GenerateWatchSnapshot } from './generate-watch-plan'

export type GenerateWatchTarget = {
  directory: string
  recursive: boolean
  fileName?: string
  /** Generator-owned directories whose attributed events must not trigger this recursive watch. */
  excludedDirectories?: readonly string[]
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

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isWithinDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

function normalizeExcludedDirectories(
  target: Pick<GenerateWatchTarget, 'directory' | 'recursive' | 'excludedDirectories'>,
): string[] {
  if (!target.recursive) return []
  return [...new Set(
    (target.excludedDirectories ?? [])
      .map((directory) => path.resolve(directory))
      .filter((directory) => isWithinDirectory(directory, target.directory)),
  )].sort(comparePaths)
}

function normalizeGenerateWatchTargets(targets: readonly GenerateWatchTarget[]): GenerateWatchTarget[] {
  const unique = new Map<string, GenerateWatchTarget>()
  for (const target of targets) {
    const directory = path.resolve(target.directory)
    const excludedDirectories = normalizeExcludedDirectories({ ...target, directory })
    const normalized: GenerateWatchTarget = {
      directory,
      recursive: target.recursive,
      ...(target.fileName === undefined ? {} : { fileName: target.fileName }),
      ...(excludedDirectories.length > 0 ? { excludedDirectories } : {}),
    }
    unique.set(targetKey(normalized), normalized)
  }

  const recursiveDirectories = new Set(
    [...unique.values()].filter((target) => target.recursive).map((target) => target.directory),
  )
  const allExcludedDirectories = [...new Set(
    [...unique.values()].flatMap((target) => target.excludedDirectories ?? []),
  )].sort(comparePaths)
  const recursiveRoots = [...recursiveDirectories]
    .filter((directory) => {
      let ancestor = path.dirname(directory)
      while (ancestor !== directory) {
        if (recursiveDirectories.has(ancestor)) return false
        const parent = path.dirname(ancestor)
        if (parent === ancestor) break
        ancestor = parent
      }
      return true
    })
    .sort(comparePaths)
    .map((directory): GenerateWatchTarget => {
      const excludedDirectories = allExcludedDirectories.filter((excluded) => (
        isWithinDirectory(excluded, directory)
      ))
      return {
        directory,
        recursive: true,
        ...(excludedDirectories.length > 0 ? { excludedDirectories } : {}),
      }
    })
  const collapsed = [...recursiveRoots]
  for (const target of unique.values()) {
    if (target.recursive) continue
    if (!target.fileName && recursiveRoots.some((root) => isWithinDirectory(target.directory, root.directory))) continue
    collapsed.push(target)
  }
  return collapsed.sort((left, right) => (
    comparePaths(left.directory, right.directory)
    || Number(left.recursive) - Number(right.recursive)
    || comparePaths(left.fileName ?? '', right.fileName ?? '')
    || comparePaths(
      JSON.stringify(left.excludedDirectories ?? []),
      JSON.stringify(right.excludedDirectories ?? []),
    )
  ))
}

export function resolveGenerateWatchTargets(options: {
  modulesFile: string
  moduleRoots: GenerateWatchModuleTarget[]
  resolveSourceMirrorBase: (packageBase: string) => string | null
  additionalInputs?: readonly string[]
  additionalDirectories?: readonly string[]
  appSourceDir?: string
  outputDir?: string
  outputDirectories?: readonly string[]
  snapshot?: GenerateWatchSnapshot
}): GenerateWatchTarget[] {
  const targets: GenerateWatchTarget[] = [options.modulesFile, ...(options.additionalInputs ?? [])].map((filePath) => ({
    directory: path.dirname(filePath),
    recursive: false,
    fileName: path.basename(filePath),
  }))
  if (options.appSourceDir) targets.push({ directory: options.appSourceDir, recursive: true })
  for (const directory of options.additionalDirectories ?? []) {
    targets.push({ directory, recursive: true })
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

  const outputRoots = [...new Set(
    [options.outputDir, ...(options.outputDirectories ?? [])]
      .filter((directory): directory is string => Boolean(directory))
      .map((directory) => path.resolve(directory)),
  )].sort(comparePaths)
  const baseRecursiveRoots = normalizeGenerateWatchTargets(targets)
    .filter((target) => target.recursive)
    .map((target) => target.directory)
  const snapshotInputs = [...new Set(
    [...(options.snapshot?.records.values() ?? [])].map((record) => path.resolve(record.path)),
  )]
    .filter((input) => !outputRoots.some((outputRoot) => isWithinDirectory(input, outputRoot)))
    .filter((input) => !baseRecursiveRoots.some((root) => isWithinDirectory(input, root)))
    .sort(comparePaths)
  const snapshotStats = snapshotInputs.map((input) => {
    try {
      return { input, stat: fs.statSync(input) }
    } catch {
      return { input, stat: undefined }
    }
  })

  for (const { input, stat } of snapshotStats) {
    if (stat?.isDirectory()) targets.push({ directory: input, recursive: true })
  }
  const recursiveRoots = normalizeGenerateWatchTargets(targets)
    .filter((target) => target.recursive)
    .map((target) => target.directory)

  for (const { input, stat } of snapshotStats) {
    if (stat?.isDirectory() || recursiveRoots.some((root) => isWithinDirectory(input, root))) continue
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

  return normalizeGenerateWatchTargets(targets.map((target) => {
    if (!target.recursive) return target
    const excludedDirectories = outputRoots.filter((outputRoot) => (
      isWithinDirectory(outputRoot, path.resolve(target.directory))
    ))
    return excludedDirectories.length > 0 ? { ...target, excludedDirectories } : target
  }))
}

function targetKey(target: GenerateWatchTarget): string {
  return JSON.stringify([
    path.resolve(target.directory),
    target.recursive,
    target.fileName ?? '',
    target.excludedDirectories ?? [],
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
      for (const target of normalizeGenerateWatchTargets(targets)) {
        if (!directoryExists(target.directory)) {
          nextSkippedDirectories.add(target.directory)
          if (!skippedDirectories.has(target.directory)) {
            try { options.onSkippedDirectory?.(target.directory) } catch {}
          }
          continue
        }
        normalizedTargets.set(targetKey(target), target)
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
              if (fileName && target.recursive && target.excludedDirectories?.length) {
                const changedPath = path.resolve(target.directory, fileName)
                if (target.excludedDirectories.some((directory) => (
                  isWithinDirectory(changedPath, directory)
                ))) return
              }
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
