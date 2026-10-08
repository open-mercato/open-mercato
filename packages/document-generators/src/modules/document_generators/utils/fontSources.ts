const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/
const PATH_SEPARATOR = /[\\/]/
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const WOFF2_FONT = /\.woff2(?:[?#]|$)/i

export function isAbsolutePath(value: string): boolean {
  return ABSOLUTE_PATH.test(value)
}

export function isRelativePathInsidePackage(value: string): boolean {
  return !isAbsolutePath(value) && !value.split(PATH_SEPARATOR).includes('..')
}

export function isNpmPackageName(value: string): boolean {
  return NPM_PACKAGE_NAME.test(value)
}

export function isWoff2Font(location: string): boolean {
  return WOFF2_FONT.test(location)
}

export function fontSourceLocation(source: { url: string } | { path: string } | { file: string }): string {
  if ('url' in source) return source.url
  if ('path' in source) return source.path
  return source.file
}
