import fs from 'node:fs'
import path from 'node:path'

/**
 * Armed contract for the AI auto-reply subscriber (issue #4778).
 *
 * This test replaces the dormancy contract that shipped with #4391. That one
 * asserted the inverse — that NO product surface could arm the subscriber —
 * which was the honest statement while the feature was de-scoped. Now that the
 * feature is real, the property worth pinning is the opposite one, and it is
 * narrower: the two arming keys have exactly ONE writer, that writer is the
 * settings command, and the operator surface in front of it is gated on
 * `channel_discord.configure`.
 *
 * Structural assertions are worth having here because the properties they cover
 * are invisible to a behavioural test: a second writer that skipped the command
 * (and therefore the optimistic-lock check and the audit entry) would keep every
 * unit test green, and so would a `features: []` regression in the subscriber —
 * the exact defect the re-review of #4391 found.
 */
const ARMING_KEYS = ['aiAutoReplyEnabled', 'aiAgentId'] as const

/** The only file allowed to WRITE the arming keys. */
const WRITER = 'commands/update-ai-auto-reply.ts'

/** Files allowed to name the keys at all, and the role each plays. */
const KEY_NAMERS = [
  WRITER,
  'lib/ai-reply.ts', // reads the toggle + agent id for the subscriber
  'lib/credentials.ts', // declares the channelState schema they live in
  'lib/channel-state-store.ts', // carries them forward when the gateway writes resume state
  'api/channels/[id]/ai-auto-reply/route.ts', // GET reads them for the settings form, PUT validates the payload before the command
  'backend/channel_discord/channels/[id]/ai-auto-reply/page.tsx', // the settings form itself
  'widgets/injection/ai-auto-reply/widget.client.tsx', // shows the current state per channel
] as const

/**
 * Prose describes the very patterns these assertions forbid — the subscriber's
 * own header explains why it never passes `features: []`. Matching against code
 * only keeps a doc comment from failing the build it is documenting.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

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

describe('channel_discord ai-auto-reply — armed contract', () => {
  const packageSrc = path.resolve(__dirname, '../../../..')
  const moduleRoot = path.join(packageSrc, 'modules', 'channel_discord')
  const files = collectSourceFiles(packageSrc)
  const relative = (file: string) => path.relative(moduleRoot, file).split(path.sep).join('/')
  const readSettingsRoute = () =>
    fs.readFileSync(path.join(moduleRoot, 'api', 'channels', '[id]', 'ai-auto-reply', 'route.ts'), 'utf8')

  it('scans a real, non-empty source tree', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain(path.join(moduleRoot, 'subscribers', 'ai-auto-reply.ts'))
  })

  it('names the arming keys only in the files that read, validate, render or write them', () => {
    const naming = files
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return ARMING_KEYS.some((key) => source.includes(key))
      })
      .map(relative)
      .sort()

    expect(naming).toEqual([...KEY_NAMERS].sort())
  })

  it('writes channelState from exactly two places — the gateway store and the settings command', () => {
    const assigning = files
      // `.channelState =` is the entity write; a bare `channelState =` is a local
      // binding (the gateway worker parses one to read resume state).
      .filter((file) => /\.channelState\s*=[^=]/.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map(relative)
      .sort()

    // Any third writer is a deliberate addition that has to argue for itself:
    // the gateway store carries the AI keys forward, and the settings command is
    // the only thing allowed to change them.
    expect(assigning).toEqual([WRITER, 'lib/channel-state-store.ts'].sort())
  })

  it('persists the settings through the command bus, not a direct entity write', () => {
    const route = stripComments(readSettingsRoute())
    expect(route).toContain('CHANNEL_DISCORD_UPDATE_AI_AUTO_REPLY_COMMAND_ID')
    expect(route).not.toMatch(/\.flush\(/)
    expect(route).not.toMatch(/nativeUpdate/)
  })

  it('never invokes the agent with an empty feature set', () => {
    const subscriber = stripComments(
      fs.readFileSync(path.join(moduleRoot, 'subscribers', 'ai-auto-reply.ts'), 'utf8'),
    )
    expect(subscriber).not.toMatch(/features:\s*\[\s*\]/)
    expect(subscriber).toContain('principal.features')
    expect(subscriber).toContain('isSuperAdmin: principal.isSuperAdmin')
  })

  it('gates the write route on the configure feature, not merely on being signed in', () => {
    // The settings route exposes GET and PUT from one file, so assert on the PUT
    // metadata block specifically: a file-wide `toContain` would still pass if the
    // configure feature only ever guarded the read half.
    const putMetadata = readSettingsRoute().match(/\n {2}PUT: \{[\s\S]*?\n {2}\},/)?.[0]
    expect(putMetadata).toBeDefined()
    expect(putMetadata).toContain('requireAuth: true')
    expect(putMetadata).toContain('CHANNEL_DISCORD_CONFIGURE_FEATURE')
  })
})
