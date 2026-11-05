import path from 'path'

/**
 * Reduce a stored relative path to safe segments: drop leading slashes, empty
 * segments, `.`, and `..`. The result can never contain a traversal segment,
 * so joining it onto a root can never climb above that root.
 */
export function sanitizeStorageRelativePath(storagePath: string): string {
  return String(storagePath ?? '')
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join(path.sep)
}

/**
 * Resolve a stored path against `joinRoot` and assert the result stays within
 * `containmentRoot` (defaults to `joinRoot`). Throws when the resolved path
 * escapes the boundary — e.g. a legacy row whose path points outside `public/`.
 */
export function resolveContainedPath(
  joinRoot: string,
  storagePath: string,
  containmentRoot?: string,
): string {
  const base = path.resolve(joinRoot)
  const boundary = path.resolve(containmentRoot ?? joinRoot)
  const candidate = path.resolve(base, sanitizeStorageRelativePath(storagePath))
  const relativeToBoundary = path.relative(boundary, candidate)
  if (relativeToBoundary.startsWith('..') || path.isAbsolute(relativeToBoundary)) {
    throw new Error('[internal] attachment storage path escapes its containment root')
  }
  return candidate
}

/**
 * The fixed sub-root that `legacyPublic` rows are allowed to resolve within.
 * Stored paths include the `public/` prefix (see Migration20251117181353), so
 * they are joined onto `process.cwd()` but constrained to `process.cwd()/public`.
 */
export function resolveLegacyPublicRoot(): string {
  return path.join(process.cwd(), 'public')
}
