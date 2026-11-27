import { z } from 'zod'

type Translate = (key: string, fallback: string) => string

export function createDiscordConnectFormSchema(t: Translate) {
  const required = t('channel_discord.connect.errors.required', 'This field is required.')
  const invalidPublicKey = t(
    'channel_discord.connect.errors.invalidPublicKey',
    'Enter the 64-character hex public key from the Developer Portal.',
  )
  const requiredText = z.string().trim().min(1, required)
  const optionalText = z.string().trim().optional()

  return z.object({
    displayName: optionalText,
    botToken: requiredText,
    applicationId: requiredText,
    publicKey: z
      .string()
      .trim()
      .min(1, required)
      .regex(/^[0-9a-fA-F]{64}$/, invalidPublicKey),
    guildId: optionalText,
    defaultChannelId: optionalText,
  })
}

export type DiscordConnectFormValues = z.infer<ReturnType<typeof createDiscordConnectFormSchema>>

export const DISCORD_CONNECT_INITIAL_VALUES: Partial<DiscordConnectFormValues> = {
  displayName: '',
  botToken: '',
  applicationId: '',
  publicKey: '',
  guildId: '',
  defaultChannelId: '',
}

export function buildDiscordConnectRequestBody(values: DiscordConnectFormValues) {
  return {
    providerKey: 'discord',
    displayName: values.displayName || 'Discord',
    credentials: {
      botToken: values.botToken,
      applicationId: values.applicationId,
      publicKey: values.publicKey,
      guildId: values.guildId || undefined,
      defaultChannelId: values.defaultChannelId || undefined,
    },
  }
}
