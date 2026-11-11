import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The two quality configs are reachable from a script, and point at a GLOB.
 *
 * `knip.json` and `.dependency-cruiser.cjs` sat in the package with nothing in the repository able to run
 * them: the only caller was a workflow on the author's fork, which deliberately never ships here. A config
 * nobody can invoke reads like a gate and is a file.
 *
 * The glob matters more than the wiring. Pointed at `packages/marketing-automation/src`, dependency-cruiser
 * collects zero modules and reports "no dependency violations found (0 modules)" — and exits 0. That is a
 * gate that passes over nothing, which is worse than no gate, and it is the mistake both the config's header
 * and the workflow warn about. Verified: with a directory it cruises 0; with the glob, 296.
 */
const PACKAGE_ROOT = join(__dirname, '..', '..', '..', '..')
const scripts = (JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}).scripts ?? {}

describe('the quality configs', () => {
  it('are both runnable through a script', () => {
    expect(scripts['check:boundaries']).toContain('.dependency-cruiser.cjs')
    expect(scripts['check:unused']).toContain('knip.json')
    // One command for both, so a contributor does not have to know there are two.
    expect(scripts['check:quality']).toContain('check:boundaries')
    expect(scripts['check:quality']).toContain('check:unused')
  })

  it('cruise a glob, never a directory', () => {
    const command = scripts['check:boundaries'] ?? ''
    expect(command).toContain('src/**/*.ts')
    // A bare directory argument is the zero-module trap.
    expect(/\bpackages\/marketing-automation\/src(?!\/\*)/.test(command)).toBe(false)
  })

  it('run from the repository root, because the configs use repo-relative paths', () => {
    // `yarn workspace` starts in the package, where `packages/marketing-automation/tsconfig.json` does not
    // resolve — the first version of this script failed on exactly that, and exited 0 while doing it.
    for (const key of ['check:boundaries', 'check:unused']) {
      expect(scripts[key]).toContain('cd ../..')
    }
  })

  it('pin the tool versions, and add neither to the lockfile', () => {
    /**
     * Through `npx --yes` with a pinned major, exactly as the fork workflow invokes them. Adding two dev
     * tools to a monorepo that uses neither is the maintainers' decision, not something to smuggle in through
     * a lockfile — and the configs are useful to a contributor without it.
     */
    expect(scripts['check:boundaries']).toContain('npx --yes dependency-cruiser@16')
    expect(scripts['check:unused']).toContain('npx --yes knip@5')
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    for (const tool of ['knip', 'dependency-cruiser']) {
      expect(Object.keys(manifest.dependencies ?? {})).not.toContain(tool)
      expect(Object.keys(manifest.devDependencies ?? {})).not.toContain(tool)
    }
  })
})
