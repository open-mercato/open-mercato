import { z } from 'zod'

export const decimal = z.string().regex(/^\d+$/)
export const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const identitySchema = z.object({ clusterIncarnation: z.string().min(1), databaseOid: decimal, serverMajor: z.number().int().min(16).max(18), encoding: z.string(), collation: z.string() }).strict()
export const evidenceSchema = z.object({ xmax: decimal, xipList: z.array(decimal).max(100000) }).strict()
export const entitySchema = z.object({ kind: z.literal('large-object').optional(), largeObjectOid: decimal.refine((value) => BigInt(value) > 0n && BigInt(value) <= 4294967295n).optional(), key: z.string().regex(/^e\d{4,8}$/), schema: z.string().min(1).max(1024), table: z.string().min(1).max(1024), columns: z.array(z.string().min(1)).max(2000), label: z.string().max(4096), estimatedRows: decimal, estimatedBytes: decimal, primaryKeys: z.array(z.string()).optional() }).strict()
export const chunkSchema = z.object({ path: z.string().regex(/^(schema\/(pre-data|post-data)|data\/e\d{4,8}\/\d+)\.chunk$/), entityKey: z.string().optional(), sequence: z.number().int().nonnegative(), rows: decimal, plainBytes: decimal, cipherBytes: decimal, sha256: digest, epoch: z.number().int().nonnegative(), keyFrom: z.array(z.string()).optional(), keyTo: z.array(z.string()).optional(), section: z.enum(['pre-data', 'post-data']).optional() }).strict()
export const indexSchema = z.object({
  schemaVersion: z.literal(1), backupId: z.string().uuid(), identity: identitySchema,
  migrationFingerprint: digest, entities: z.array(entitySchema).max(100000), chunks: z.array(chunkSchema).max(1000000), catalogDigest: digest,
  evidence: evidenceSchema, epochs: z.number().int().positive(), consistency: z.enum(['single-snapshot', 'quiesced', 'multi-snapshot']),
  sequences: z.array(z.object({ schema: z.string(), name: z.string(), value: decimal, isCalled: z.boolean(), maxValue: decimal.optional() }).strict()).max(100000),
  foreignKeys: z.array(z.object({ schema: z.string(), table: z.string(), name: z.string(), definition: z.string() }).strict()).max(1000000),
}).strict()
export const manifestSchema = z.object({
  schemaVersion: z.literal(1), state: z.literal('complete'), backupId: z.string().uuid(),
  kind: z.literal('postgresql-logical-chunked'), scope: z.literal('whole-database'), startedAt: z.string().datetime(), completedAt: z.string().datetime(),
  encryption: z.object({ mode: z.enum(['age-v1', 'none']), recipientSetFingerprint: digest.optional() }).strict(),
  compression: z.literal('gzip'), consistency: z.object({ mode: z.enum(['single-snapshot', 'quiesced', 'multi-snapshot']), epochs: z.number().int().positive() }).strict(),
  sourceIdentityDigest: digest, serverMajor: z.number().int().min(16).max(18), encoding: z.string(), collation: z.string(),
  index: z.object({ path: z.enum(['index.age', 'index.json']), sizeBytes: decimal, sha256: digest }).strict(),
  chunkCount: z.number().int().nonnegative().max(1000000), totalCipherBytes: decimal,
  exclusions: z.array(z.enum(['external-files', 'object-stores', 'vault', 'redis', 'cluster-globals', 'wal'])),
}).strict()
export const checksSchema = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('row-count'), entityKey: z.string(), minimum: decimal, maximum: decimal }).strict(),
  z.object({ type: z.literal('artifact-integrity') }).strict(),
  z.object({ type: z.literal('migration-fingerprint'), expectedSha256: digest.optional() }).strict(),
  z.object({ type: z.literal('encrypted-canary'), entityKey: z.string(), field: z.string().min(1).max(63), key: z.record(z.string(), z.string().max(4096)).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 8), keyHandle: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/), expectedSha256: digest }).strict(),
])).max(100)
export type Manifest = z.infer<typeof manifestSchema>
export type BackupIndex = z.infer<typeof indexSchema>
export type Chunk = z.infer<typeof chunkSchema>
