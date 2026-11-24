import path from 'node:path'
import { z } from 'zod'

export const INFINISPAN_SASL_MECHANISMS = ['SCRAM-SHA-256', 'SCRAM-SHA-512', 'SCRAM-SHA-384', 'DIGEST-MD5'] as const
export const INFINISPAN_PROTOCOL_VERSIONS = ['4.1', '4.0', '3.1'] as const

const hostSchema = z.string().trim().min(1).max(255).regex(/^[a-zA-Z0-9.:_[\]-]+$/, 'Expected a host name or IP address')

export const infinispanServerSchema = z.object({
  host: hostSchema,
  port: z.number().int().min(1).max(65535).default(11222),
}).strict()

export const infinispanAuthSchema = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(4096),
  mechanism: z.enum(INFINISPAN_SASL_MECHANISMS).default('SCRAM-SHA-256'),
}).strict()

const absoluteFilePath = z.string().min(1).refine((value) => path.isAbsolute(value), 'Expected an absolute file path')

export const infinispanTlsSchema = z.object({
  enabled: z.literal(true),
  caFiles: z.array(absoluteFilePath).min(1).max(16),
  serverName: hostSchema.optional(),
}).strict()

export const infinispanSettingsSchema = z.object({
  servers: z.array(infinispanServerSchema).min(1).max(32),
  cacheName: z.string().trim().min(1).max(255).regex(/^[a-zA-Z0-9._-]+$/, 'Expected a cache name of letters, digits, ".", "_" or "-"'),
  auth: infinispanAuthSchema,
  tls: infinispanTlsSchema.optional(),
  protocolVersion: z.enum(INFINISPAN_PROTOCOL_VERSIONS).default('4.1'),
  topologyUpdates: z.boolean().default(true),
  connectTimeoutMs: z.number().int().min(100).max(120_000).default(5_000),
  commandTimeoutMs: z.number().int().min(50).max(120_000).default(5_000),
  iteratorBatchSize: z.number().int().min(1).max(10_000).default(256),
  concurrency: z.number().int().min(1).max(256).default(16),
  maxCasAttempts: z.number().int().min(1).max(1_000).default(64),
  tagIndexShards: z.number().int().min(1).max(1_024).default(64),
  maxTagsPerEntry: z.number().int().min(1).max(1_024).default(64),
  maxValueBytes: z.number().int().min(1_024).max(64 * 1024 * 1024).default(4 * 1024 * 1024),
  indexPruneGraceMs: z.number().int().min(1_000).max(24 * 60 * 60 * 1000).default(120_000),
}).strict().superRefine((config, context) => {
  if (config.indexPruneGraceMs < config.commandTimeoutMs * 4) {
    context.addIssue({
      code: 'custom',
      path: ['indexPruneGraceMs'],
      message: 'indexPruneGraceMs must be at least four times commandTimeoutMs',
    })
  }
})

export type InfinispanSettingsInput = z.input<typeof infinispanSettingsSchema>
export type InfinispanSettings = z.output<typeof infinispanSettingsSchema>

export function redactInfinispanSettings(config: InfinispanSettings): Record<string, unknown> {
  return {
    servers: config.servers.length,
    cacheName: config.cacheName,
    auth: { mechanism: config.auth.mechanism, username: '[redacted]', password: '[redacted]' },
    tls: config.tls ? { enabled: true, caFiles: config.tls.caFiles.length, serverName: config.tls.serverName ?? null } : { enabled: false },
    protocolVersion: config.protocolVersion,
    topologyUpdates: config.topologyUpdates,
    connectTimeoutMs: config.connectTimeoutMs,
    commandTimeoutMs: config.commandTimeoutMs,
    iteratorBatchSize: config.iteratorBatchSize,
    concurrency: config.concurrency,
    maxCasAttempts: config.maxCasAttempts,
    tagIndexShards: config.tagIndexShards,
    maxTagsPerEntry: config.maxTagsPerEntry,
    maxValueBytes: config.maxValueBytes,
    indexPruneGraceMs: config.indexPruneGraceMs,
  }
}
