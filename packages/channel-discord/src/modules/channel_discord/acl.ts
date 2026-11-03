/**
 * Feature ids are repeated here as string literals rather than referenced from
 * `lib/ai-features.ts`: the ACL translation catalog guard
 * (`core/auth/__tests__/acl-feature-catalog.i18n.test.ts`) parses this file's AST
 * to align every declared title with `auth/i18n/*.json`, and an identifier it
 * cannot resolve statically fails that check. `lib/ai-features.ts` keeps the same
 * strings for the code paths that need to import them.
 */
export const features = [
  { id: 'channel_discord.view', title: 'View Discord channel configuration', module: 'channel_discord' },
  { id: 'channel_discord.configure', title: 'Configure Discord bot channel', module: 'channel_discord' },
  {
    id: 'channel_discord.ai_auto_reply.run',
    title: 'Run the Discord AI auto-reply agent',
    module: 'channel_discord',
  },
]

export default features
