import fs from 'node:fs'
import path from 'node:path'

/**
 * Regression (#7102): CLI commands and workers load package dists that import
 * bare `next/dynamic`, `next/link`, … which plain Node ESM cannot resolve. The
 * entry must install the resolve hook before anything can import such a dist.
 */
describe('bin.ts next/<subpath> resolve hook', () => {
  const binSource = fs.readFileSync(path.resolve(__dirname, '../../bin.ts'), 'utf8')

  it('imports the shared resolve hook', () => {
    expect(binSource).toContain(
      "import { installNextSubpathResolveHook } from '@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook'",
    )
  })

  it('installs the hook before bootstrapping or loading the mercato entry', () => {
    const installCall = binSource.indexOf('installNextSubpathResolveHook()')
    expect(installCall).toBeGreaterThan(-1)
    expect(installCall).toBeLessThan(binSource.indexOf('await loadAppEnv()'))
    expect(installCall).toBeLessThan(binSource.indexOf('await tryBootstrap(bootstrapMode)'))
    expect(installCall).toBeLessThan(binSource.indexOf("const { run } = await import('./mercato.js')"))
  })
})
