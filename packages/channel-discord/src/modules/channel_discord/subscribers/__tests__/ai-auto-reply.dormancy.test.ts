import fs from 'node:fs'
import path from 'node:path'

/**
 * Dormancy contract for the AI auto-reply subscriber (review of #4391, @pkarw
 * 2026-07-30 Major 2 → de-scoped to open-mercato/open-mercato#4778).
 *
 * The release ships the subscriber as inert scaffolding and claims, in prose,
 * that "nothing in the product writes the two channel-state keys that arm it".
 * Prose is not a guarantee, and the subscriber's own unit tests cannot provide
 * one: they hand-arm `channelState` and stub the AI runtime, so they prove the
 * wiring works when armed, never that nothing arms it.
 *
 * This test provides the guarantee the prose asserts. It fails the moment a
 * widget, API route, setup hook, preset, CLI command or integration descriptor
 * in this package starts naming an arming key — which is precisely the change
 * that would turn AI auto-reply into a product capability, and which must land
 * with #4778 (a configurable agent identity, the proposal surface for the
 * `complex` tier, and coverage against the real agent policy) rather than
 * silently.
 */
const ARMING_KEYS = ['aiAutoReplyEnabled', 'aiAgentId'] as const

/**
 * The three files allowed to name an arming key, and why. All three READ the
 * keys; none of them is reachable from an operator-facing surface.
 */
const READERS = [
  'lib/ai-reply.ts',
  'lib/credentials.ts',
  'lib/channel-state-store.ts',
  'subscribers/ai-auto-reply.ts',
] as const

function collectSourceFiles(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__integration__') continue
        walk(absolute)
        continue
      }
      if (/\.(ts|tsx)$/.test(entry.name)) found.push(absolute)
    }
  }
  walk(root)
  return found
}

describe('channel_discord ai-auto-reply — dormancy contract', () => {
  const packageSrc = path.resolve(__dirname, '../../../..')
  const moduleRoot = path.join(packageSrc, 'modules', 'channel_discord')
  const files = collectSourceFiles(packageSrc)

  it('scans a real, non-empty source tree', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain(path.join(moduleRoot, 'subscribers', 'ai-auto-reply.ts'))
  })

  it('names the arming keys only in the files that read them', () => {
    const naming = files
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return ARMING_KEYS.some((key) => source.includes(key))
      })
      .map((file) => path.relative(moduleRoot, file).split(path.sep).join('/'))
      .sort()

    expect(naming).toEqual([...READERS].sort())
  })

  it('exposes no operator-facing surface that could arm the subscriber', () => {
    const operatorSurfaces = files.filter((file) => {
      const relative = path.relative(moduleRoot, file).split(path.sep).join('/')
      return (
        relative.startsWith('widgets/') ||
        relative.startsWith('api/') ||
        ['setup.ts', 'cli.ts', 'integration.ts', 'lib/preset.ts', 'acl.ts'].includes(relative)
      )
    })
    expect(operatorSurfaces.length).toBeGreaterThan(4)

    for (const file of operatorSurfaces) {
      const source = fs.readFileSync(file, 'utf8')
      for (const key of ARMING_KEYS) {
        expect({
          file: path.relative(moduleRoot, file).split(path.sep).join('/'),
          key,
          named: source.includes(key),
        }).toEqual({
          file: path.relative(moduleRoot, file).split(path.sep).join('/'),
          key,
          named: false,
        })
      }
    }
  })
})
