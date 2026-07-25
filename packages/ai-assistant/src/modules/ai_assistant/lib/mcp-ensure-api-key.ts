import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import {
  createApiKey,
  deleteApiKey,
  findApiKeyBySecret,
} from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getUserRoleIds } from './user-role-ids'

export const DEFAULT_MCP_KEY_NAME = '__mcp_server__'
export const DEFAULT_MCP_KEY_OWNER_EMAIL = 'superadmin@acme.com'

export type EnsureMcpApiKeyOptions = {
  em: EntityManager
  filePath: string
  keyName?: string
  ownerEmail?: string
  rotate?: boolean
  rbac?: RbacService
}

export type EnsureMcpApiKeyResult = {
  status: 'valid' | 'created'
  keyId: string
  keyPrefix: string
}

async function readSecretFile(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

async function writeSecretFile(filePath: string, secret: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  // World-readable on purpose: the file lives in a dedicated named volume
  // mounted only into this stack's containers, and the consumer (the OpenCode
  // container) runs as a non-root user that cannot read a root-owned 0600
  // file. The volume boundary, not the file mode, is the security boundary.
  await fs.writeFile(tmpPath, `${secret}\n`, { mode: 0o644 })
  await fs.rename(tmpPath, filePath)
  await fs.chmod(filePath, 0o644)
}

/**
 * Ensure a valid MCP server API key exists and its plaintext secret is stored
 * in `filePath`. The DB only holds a bcrypt hash, so the secret file is the
 * idempotency anchor: when it still resolves to a live key of the expected
 * name, nothing changes. Otherwise stale keys with that name are soft-deleted
 * and a fresh key is created, owned by the superadmin user so header-only MCP
 * calls resolve an ACL context via `createdBy`.
 */
export async function ensureMcpApiKey(options: EnsureMcpApiKeyOptions): Promise<EnsureMcpApiKeyResult> {
  const keyName = options.keyName?.trim() || DEFAULT_MCP_KEY_NAME
  const existingSecret = await readSecretFile(options.filePath)

  if (existingSecret && existingSecret.startsWith('omk_') && !options.rotate) {
    const existingKey = await findApiKeyBySecret(options.em, existingSecret)
    if (existingKey && existingKey.name === keyName) {
      return { status: 'valid', keyId: existingKey.id, keyPrefix: existingKey.keyPrefix }
    }
  }

  const ownerEmail =
    options.ownerEmail?.trim() ||
    process.env.OM_INIT_SUPERADMIN_EMAIL?.trim() ||
    DEFAULT_MCP_KEY_OWNER_EMAIL
  // User.email is encrypted at rest with an email_hash lookup column, and
  // findOneWithDecryption does not rewrite filters — a plaintext { email }
  // match would find nothing once encryption is on. Mirror the $or pattern
  // from AuthService.findUserByEmail so both modes resolve the owner.
  const owner = await findOneWithDecryption(
    options.em,
    User,
    {
      deletedAt: null,
      $or: [
        { email: ownerEmail },
        { emailHash: { $in: emailHashLookupValues(ownerEmail) } },
      ],
    },
    {},
    { tenantId: null, organizationId: null },
  )
  if (!owner) {
    throw new Error(
      `[internal] MCP API key owner not found: no active user with email "${ownerEmail}". ` +
        'Run "mercato init" first or pass --email pointing at an existing admin user.',
    )
  }

  const roleIds = await getUserRoleIds(options.em, owner.id, owner.tenantId ?? null)

  // Scope the cleanup to the owner's tenant: keys with the same name in other
  // tenants belong to other stacks/tenants and must never be revoked here.
  const staleKeys = await options.em.find(ApiKey, {
    name: keyName,
    tenantId: owner.tenantId ?? null,
    deletedAt: null,
  })
  for (const staleKey of staleKeys) {
    await deleteApiKey(options.em, staleKey.id, { rbac: options.rbac })
  }

  const { record, secret } = await createApiKey(
    options.em,
    {
      name: keyName,
      description: 'MCP server key provisioned by mcp:ensure-api-key',
      tenantId: owner.tenantId ?? null,
      organizationId: null,
      roles: roleIds,
      createdBy: owner.id,
    },
    { rbac: options.rbac },
  )

  await writeSecretFile(options.filePath, secret)

  return { status: 'created', keyId: record.id, keyPrefix: record.keyPrefix }
}
