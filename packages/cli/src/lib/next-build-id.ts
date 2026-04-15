import fs from 'node:fs'
import path from 'node:path'

type BuildManifestShape = {
  lowPriorityFiles?: unknown
  rootMainFiles?: unknown
  pages?: Record<string, unknown>
}

function readBuildIdFromFile(buildIdPath: string): string | null {
  try {
    const value = fs.readFileSync(buildIdPath, 'utf8').trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

function extractBuildIdFromValues(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const match = value.match(/^static\/([^/]+)\//)
    if (match?.[1]) {
      return match[1]
    }
  }
  return null
}

function readBuildIdFromManifest(manifestPath: string): string | null {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as BuildManifestShape
    const pageValues = Object.values(parsed.pages ?? {}).flatMap((value) => Array.isArray(value) ? value : [value])
    return extractBuildIdFromValues([
      ...(Array.isArray(parsed.lowPriorityFiles) ? parsed.lowPriorityFiles : []),
      ...(Array.isArray(parsed.rootMainFiles) ? parsed.rootMainFiles : []),
      ...pageValues,
    ])
  } catch {
    return null
  }
}

export function resolveNextBuildIdCandidate(distDir: string): string | null {
  const directBuildId = readBuildIdFromFile(path.join(distDir, 'BUILD_ID'))
  if (directBuildId) {
    return directBuildId
  }

  for (const manifestName of ['fallback-build-manifest.json', 'build-manifest.json']) {
    const manifestBuildId = readBuildIdFromManifest(path.join(distDir, manifestName))
    if (manifestBuildId) {
      return manifestBuildId
    }
  }

  return null
}
