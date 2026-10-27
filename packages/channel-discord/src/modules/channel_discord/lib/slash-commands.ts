/**
 * Application (slash) commands this provider registers against a guild.
 *
 * NOT LOCALIZED, deliberately: a Discord application registers ONE canonical
 * command name per guild — the localized variants Discord supports live in
 * `name_localizations` / `description_localizations`, which are a per-command
 * map rather than an app locale, and no operator surface exists yet to choose
 * which locales a tenant wants. The registration is also an operator action
 * (`mercato channel_discord register-slash-commands`), not a rendered UI string.
 *
 * The set is deliberately minimal. Every command routes to the same place —
 * the hub inbox — so the provider ships the one command that makes that useful
 * and leaves richer command trees to whoever knows their own workflow. Register
 * a different set by passing `--commands <path-to-json>`.
 */
export const CHANNEL_DISCORD_SLASH_COMMAND_TYPE_CHAT_INPUT = 1
export const CHANNEL_DISCORD_OPTION_TYPE_STRING = 3

export const DISCORD_DEFAULT_SLASH_COMMANDS: Array<Record<string, unknown>> = [
  {
    name: 'mercato',
    type: CHANNEL_DISCORD_SLASH_COMMAND_TYPE_CHAT_INPUT,
    description: 'Send a message to the team through Open Mercato',
    options: [
      {
        type: CHANNEL_DISCORD_OPTION_TYPE_STRING,
        name: 'message',
        description: 'What do you need?',
        required: true,
      },
    ],
  },
]

/**
 * Validate an operator-supplied command list read from JSON. Discord rejects a
 * malformed registration with a 400 whose body names an array index, so failing
 * here with the index and the reason is strictly more useful than forwarding it.
 */
export function parseSlashCommandDefinitions(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new Error('[internal] Discord slash command definitions must be a JSON array.')
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`[internal] Discord slash command at index ${index} is not an object.`)
    }
    const command = entry as Record<string, unknown>
    if (typeof command.name !== 'string' || command.name.length === 0) {
      throw new Error(`[internal] Discord slash command at index ${index} has no name.`)
    }
    if (typeof command.description !== 'string' || command.description.length === 0) {
      throw new Error(`[internal] Discord slash command "${command.name}" has no description.`)
    }
    return command
  })
}
