import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  AuthPrincipalLabel,
  AuthPrincipalService,
  PrincipalScope,
} from '@open-mercato/shared/lib/auth/principal-service'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role, User, UserRole } from '../data/entities'
import { listSuperAdminUserIds } from '../lib/grantChecks'

function normalizeIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
}

export class DefaultAuthPrincipalService implements AuthPrincipalService {
  constructor(private readonly em: EntityManager) {}

  async principalExists(input: {
    type: 'user' | 'role'
    id: string
    scope: PrincipalScope
  }): Promise<boolean> {
    if (input.type === 'role') {
      return Boolean(await findOneWithDecryption(
        this.em,
        Role,
        { id: input.id, tenantId: input.scope.tenantId, deletedAt: null },
        { fields: ['id'] as const },
        input.scope,
      ))
    }
    return Boolean(await findOneWithDecryption(
      this.em,
      User,
      {
        id: input.id,
        tenantId: input.scope.tenantId,
        deletedAt: null,
        $or: [{ organizationId: null }, { organizationId: input.scope.organizationId }],
      } as FilterQuery<User>,
      { fields: ['id'] as const },
      input.scope,
    ))
  }

  async resolveActiveUserRoleIds(userId: string, scope: PrincipalScope): Promise<string[]> {
    const links = await findWithDecryption(
      this.em,
      UserRole,
      {
        user: userId,
        deletedAt: null,
        role: { tenantId: scope.tenantId, deletedAt: null },
      } as FilterQuery<UserRole>,
      { fields: ['role'] as const },
      scope,
    )
    return normalizeIds(links.map((link) => String((link.role as { id?: string })?.id ?? link.role)))
  }

  async filterActiveRoleIds(roleIds: string[], scope: PrincipalScope): Promise<string[]> {
    const ids = normalizeIds(roleIds)
    if (ids.length === 0) return []
    const roles = await findWithDecryption(
      this.em,
      Role,
      { id: { $in: ids }, tenantId: scope.tenantId, deletedAt: null } as FilterQuery<Role>,
      { fields: ['id'] as const },
      scope,
    )
    return normalizeIds(roles.map((role) => role.id))
  }

  async resolveLabels(input: {
    type: 'user' | 'role'
    ids: string[]
    scope: PrincipalScope
  }): Promise<AuthPrincipalLabel[]> {
    const ids = normalizeIds(input.ids)
    if (ids.length === 0) return []
    if (input.type === 'role') {
      const roles = await findWithDecryption(
        this.em,
        Role,
        { id: { $in: ids }, tenantId: input.scope.tenantId, deletedAt: null } as FilterQuery<Role>,
        { fields: ['id', 'name'] as const },
        input.scope,
      )
      return roles.map((role) => ({ id: role.id, label: role.name, secondary: null }))
    }
    const users = await findWithDecryption(
      this.em,
      User,
      {
        id: { $in: ids },
        tenantId: input.scope.tenantId,
        deletedAt: null,
        $or: [{ organizationId: null }, { organizationId: input.scope.organizationId }],
      } as FilterQuery<User>,
      { fields: ['id', 'name', 'email'] as const },
      input.scope,
    )
    return users.map((user) => ({
      id: user.id,
      label: user.name?.trim() || user.email,
      secondary: user.name?.trim() && user.email !== user.name.trim() ? user.email : null,
    }))
  }

  async listSuperAdminUserIds(tenantId: string): Promise<string[]> {
    return Array.from(await listSuperAdminUserIds(this.em, tenantId))
  }
}
