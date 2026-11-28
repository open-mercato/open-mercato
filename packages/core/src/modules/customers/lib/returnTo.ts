const RETURN_TO_ORIGIN = 'https://backoffice.invalid'
const BACKEND_PATH_PREFIX = '/backend/'

export function resolveReturnTo(value: string | null | undefined): string | null {
  if (!value?.startsWith(BACKEND_PATH_PREFIX)) return null

  const destination = new URL(value, RETURN_TO_ORIGIN)
  const { origin, pathname, search, hash } = destination
  if (origin !== RETURN_TO_ORIGIN || !pathname.startsWith(BACKEND_PATH_PREFIX) || pathname.includes('//')) {
    return null
  }

  return `${pathname}${search}${hash}`
}
