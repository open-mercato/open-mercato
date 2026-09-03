export type NextDevBundler = 'turbopack' | 'webpack'

export function resolveNextDevBundler(environment: NodeJS.ProcessEnv = process.env): NextDevBundler {
  return environment.OM_DEV_BUNDLER?.trim().toLowerCase() === 'webpack'
    ? 'webpack'
    : 'turbopack'
}

export function buildNextDevArgs(
  nextBinary: string,
  environment: NodeJS.ProcessEnv = process.env,
): { args: string[]; bundler: NextDevBundler } {
  const bundler = resolveNextDevBundler(environment)
  return {
    args: [nextBinary, 'dev', bundler === 'webpack' ? '--webpack' : '--turbopack'],
    bundler,
  }
}
