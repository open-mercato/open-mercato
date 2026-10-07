import fs from 'node:fs'
import path from 'node:path'

/**
 * The hub must not depend on the CRM.
 *
 * `customers` already subscribes to this module's events (the two
 * `link-channel-message-*` subscribers, and the channel-visibility cache
 * invalidation). If `communication_channels` imports `customers` back, the two
 * become mutually dependent: the hub stops being installable without the CRM,
 * and `requires: ['progress']` silently understates what it needs.
 *
 * The regression this pins actually happened: the channel-visibility route
 * imported `customers/lib/personDetailCacheTags` to invalidate the CRM's cache
 * directly, instead of letting the CRM react to the
 * `communication_channels.channel.visibility_changed` event the command already
 * emits with the tenant/organization scope.
 */

const MODULE_ROOT = path.resolve(__dirname, '..')
const FORBIDDEN = /@open-mercato\/core\/modules\/customers/

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'migrations') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc)
      continue
    }
    if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe('communication_channels does not depend on customers', () => {
  it('imports nothing from the customers module', () => {
    const offenders = collectSourceFiles(MODULE_ROOT)
      .filter((file) => FORBIDDEN.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(MODULE_ROOT, file))

    // On failure jest prints the array, naming the offending files directly.
    expect(offenders).toEqual([])
  })

  it('still declares its real dependencies', async () => {
    const mod = await import('../index')
    expect(mod.metadata.requires).toEqual(['progress'])
  })
})
