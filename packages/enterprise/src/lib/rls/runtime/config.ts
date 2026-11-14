import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).max(63)
const poolMode = z.enum(['direct', 'session'])

export type TenantBoundaryConfiguration =
  | Readonly<{ enabled: false }>
  | Readonly<{ enabled: true; poolMode: 'direct' | 'session'; schema: string; manifestPath?: string }>

export function readTenantBoundaryConfiguration(env: NodeJS.ProcessEnv = process.env): TenantBoundaryConfiguration {
  const raw = env.OM_TENANT_RLS?.trim()
  if (!raw) return Object.freeze({ enabled: false })
  const enabled = parseBooleanToken(raw)
  if (enabled === null) throw new Error('[internal] OM_TENANT_RLS must be a recognized boolean token')
  if (!enabled) return Object.freeze({ enabled: false })
  const mode = poolMode.safeParse(env.OM_TENANT_RLS_POOL_MODE?.trim())
  if (!mode.success) throw new Error('[internal] OM_TENANT_RLS_POOL_MODE must explicitly be direct or session; transaction pooling is unsupported')
  const schema = identifier.safeParse(env.OM_TENANT_RLS_SCHEMA?.trim() || 'public')
  if (!schema.success || schema.data.startsWith('pg_') || schema.data === 'information_schema') throw new Error('[internal] OM_TENANT_RLS_SCHEMA must be a PostgreSQL identifier')
  return Object.freeze({
    enabled: true,
    poolMode: mode.data,
    schema: schema.data,
    ...(env.OM_TENANT_RLS_MANIFEST?.trim() ? { manifestPath: env.OM_TENANT_RLS_MANIFEST.trim() } : {}),
  })
}

export function quoteBoundaryIdentifier(value: string): string {
  if (!identifier.safeParse(value).success) throw new Error('[internal] Invalid tenant boundary SQL identifier')
  return `"${value}"`
}

function parseDatabaseUrl(value: string | undefined): URL {
  if (!value) throw new Error('[internal] Tenant boundary database connection is not configured')
  try {
    const parsed = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname || !parsed.username) {
      throw new Error('[internal] Unsupported tenant boundary database connection')
    }
    return parsed
  } catch {
    throw new Error('[internal] Tenant boundary requires a PostgreSQL connection URL')
  }
}

export function resolveTenantMaintenanceUrl(env: NodeJS.ProcessEnv = process.env, defaultRuntimeUrl = env.DATABASE_URL): string {
  const maintenance = env.OM_TENANT_RLS_MAINTENANCE_DATABASE_URL
  const runtime = parseDatabaseUrl(defaultRuntimeUrl)
  const privileged = parseDatabaseUrl(maintenance)
  if (runtime.username === privileged.username) {
    throw new Error('[internal] Tenant boundary maintenance must use a distinct database role')
  }
  if (runtime.hostname !== privileged.hostname || (runtime.port || '5432') !== (privileged.port || '5432') || runtime.pathname !== privileged.pathname) {
    throw new Error('[internal] Tenant boundary maintenance must target the same database endpoint')
  }
  return maintenance!
}
