import { z } from 'zod'

export const RESP_DEFAULTS = {
  port: 6379,
  connectTimeoutMs: 5_000,
  commandTimeoutMs: 2_000,
  maxRetriesPerRequest: 1,
  batchSize: 500,
  maxValueBytes: 8 * 1024 * 1024,
  tryAgainAttempts: 40,
} as const

export const RESP_LIMITS = {
  maxTimeoutMs: 120_000,
  maxBatchSize: 5_000,
  maxValueBytes: 512 * 1024 * 1024,
  maxRetriesPerRequest: 10,
} as const

const hostSchema = z.string().trim().min(1).max(255)
const portSchema = z.number().int().min(1).max(65535)
const pemSchema = z.string().min(1).max(64 * 1024)

export const respTlsSettingsSchema = z.object({
  ca: pemSchema.optional(),
  cert: pemSchema.optional(),
  key: pemSchema.optional(),
  servername: z.string().trim().min(1).max(255).optional(),
  rejectUnauthorized: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if ((value.cert === undefined) !== (value.key === undefined)) {
    context.addIssue({ code: 'custom', path: [value.cert === undefined ? 'cert' : 'key'], message: 'Client certificate and key must be configured together' })
  }
})

const credentialShape = {
  username: z.string().min(1).max(256).optional(),
  password: z.string().min(1).max(4096).optional(),
}

const tuningShape = {
  tls: respTlsSettingsSchema.optional(),
  connectTimeoutMs: z.number().int().min(100).max(RESP_LIMITS.maxTimeoutMs).default(RESP_DEFAULTS.connectTimeoutMs),
  commandTimeoutMs: z.number().int().min(50).max(RESP_LIMITS.maxTimeoutMs).default(RESP_DEFAULTS.commandTimeoutMs),
  maxRetriesPerRequest: z.number().int().min(0).max(RESP_LIMITS.maxRetriesPerRequest).default(RESP_DEFAULTS.maxRetriesPerRequest),
  batchSize: z.number().int().min(1).max(RESP_LIMITS.maxBatchSize).default(RESP_DEFAULTS.batchSize),
  maxValueBytes: z.number().int().min(1024).max(RESP_LIMITS.maxValueBytes).default(RESP_DEFAULTS.maxValueBytes),
}

function requirePasswordWithUsername(value: { username?: string; password?: string }, context: z.RefinementCtx): void {
  if (value.username !== undefined && value.password === undefined) {
    context.addIssue({ code: 'custom', path: ['password'], message: 'An ACL username requires a password' })
  }
}

export const respStandaloneSettingsSchema = z.object({
  mode: z.literal('standalone').default('standalone'),
  host: hostSchema,
  port: portSchema.default(RESP_DEFAULTS.port),
  db: z.number().int().min(0).max(255).default(0),
  ...credentialShape,
  ...tuningShape,
}).strict().superRefine(requirePasswordWithUsername)

export const respClusterSettingsSchema = z.object({
  mode: z.literal('cluster'),
  nodes: z.array(z.object({ host: hostSchema, port: portSchema.default(RESP_DEFAULTS.port) }).strict()).min(1).max(64),
  ...credentialShape,
  ...tuningShape,
}).strict().superRefine(requirePasswordWithUsername)

/** Standalone-only settings: the first supported profile of every OSS RESP provider. */
export function createRespStandaloneSettingsSchema() {
  return respStandaloneSettingsSchema
}

/** Standalone or cluster settings, for providers whose matrix includes a qualified cluster profile. */
export function createRespSettingsSchema() {
  return z.union([respStandaloneSettingsSchema, respClusterSettingsSchema])
}

export type RespTlsSettings = z.infer<typeof respTlsSettingsSchema>
export type RespStandaloneSettings = z.infer<typeof respStandaloneSettingsSchema>
export type RespClusterSettings = z.infer<typeof respClusterSettingsSchema>
export type RespSettings = RespStandaloneSettings | RespClusterSettings
export type RespSettingsInput = z.input<typeof respStandaloneSettingsSchema> | z.input<typeof respClusterSettingsSchema>

const REDACTED = '[redacted]'

/** Operator-safe view of RESP settings: endpoints and tuning only, never secrets or key material. */
export function redactRespSettings(settings: RespSettings): Record<string, unknown> {
  const endpoint = settings.mode === 'cluster'
    ? { nodes: settings.nodes.map((node) => `${node.host}:${node.port}`) }
    : { host: settings.host, port: settings.port, db: settings.db }
  return {
    mode: settings.mode,
    ...endpoint,
    username: settings.username !== undefined ? REDACTED : null,
    password: settings.password !== undefined ? REDACTED : null,
    tls: settings.tls
      ? {
        enabled: true,
        ca: settings.tls.ca !== undefined ? 'configured' : 'system',
        clientCertificate: settings.tls.cert !== undefined,
        servername: settings.tls.servername ?? null,
        rejectUnauthorized: settings.tls.rejectUnauthorized,
      }
      : { enabled: false },
    connectTimeoutMs: settings.connectTimeoutMs,
    commandTimeoutMs: settings.commandTimeoutMs,
    maxRetriesPerRequest: settings.maxRetriesPerRequest,
    batchSize: settings.batchSize,
    maxValueBytes: settings.maxValueBytes,
  }
}
