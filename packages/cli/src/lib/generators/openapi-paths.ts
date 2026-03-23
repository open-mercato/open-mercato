import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveOpenApiGeneratorProjectRoot(
  moduleUrl: string,
  options?: { windows?: boolean }
): string {
  const pathModule = options?.windows === undefined
    ? path
    : options.windows ? path.win32 : path.posix
  const modulePath = options?.windows === undefined
    ? fileURLToPath(moduleUrl)
    : fileURLToPath(moduleUrl, { windows: options.windows })

  return pathModule.resolve(pathModule.dirname(modulePath), '../../../../..')
}
