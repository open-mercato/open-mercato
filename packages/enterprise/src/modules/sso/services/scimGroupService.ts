import { EntityManager, type FilterQuery, type RequiredEntityData } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ScimGroup, ScimGroupMember, SsoIdentity, ScimProvisioningLog } from '../data/entities'
import { buildListResponse } from '../lib/scim-response'
import {
  extractPatchMemberIds,
  parseScimGroupFilter,
  type ScimGroupPatchOperation,
  type ScimGroupPayload,
  type ScimGroupResource,
  toScimGroupResource,
} from '../lib/scim-group'
import { syncSsoRoleGrants } from '../lib/sso-role-sync'
import type { ScimScope } from '../api/scim/context'

export class ScimGroupService {
  constructor(private em: EntityManager) {}

  async createGroup(payload: ScimGroupPayload, scope: ScimScope, baseUrl: string): Promise<ScimGroupResource> {
    if (payload.externalId) {
      const existing = await this.em.findOne(ScimGroup, {
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
        externalId: payload.externalId,
      })
      if (existing) return this.getGroup(existing.id, scope, baseUrl)
    }

    return this.em.transactional(async (transactionalEm) => {
      const group = transactionalEm.create(ScimGroup, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        ssoConfigId: scope.ssoConfigId,
        externalId: payload.externalId ?? null,
        displayName: payload.displayName,
      } as RequiredEntityData<ScimGroup>)
      transactionalEm.persist(group)
      await transactionalEm.flush()

      const memberIds = payload.members.map((member) => member.value)
      await this.replaceMembers(transactionalEm, group, memberIds, scope)
      await this.log(transactionalEm, scope, 'CREATE', group.id, payload.externalId ?? null, 201)
      return this.toResource(transactionalEm, group, baseUrl)
    })
  }

  async getGroup(groupId: string, scope: ScimScope, baseUrl: string): Promise<ScimGroupResource> {
    const group = await this.requireGroup(this.em, groupId, scope)
    return this.toResource(this.em, group, baseUrl)
  }

  async listGroups(
    filter: string | null,
    startIndex: number,
    count: number,
    scope: ScimScope,
    baseUrl: string,
  ): Promise<Record<string, unknown>> {
    const parsedFilter = parseScimGroupFilter(filter)
    const where: FilterQuery<ScimGroup> = {
      ssoConfigId: scope.ssoConfigId,
      organizationId: scope.organizationId,
    }

    if (parsedFilter?.field === 'displayName') where.displayName = parsedFilter.value
    if (parsedFilter?.field === 'externalId') where.externalId = parsedFilter.value
    if (parsedFilter?.field === 'members.value') {
      const membership = await this.em.findOne(ScimGroupMember, {
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
        identityId: parsedFilter.value,
      })
      if (!membership) return buildListResponse([], 0, startIndex, 0)
      where.id = membership.groupId
    }

    const [groups, total] = await this.em.findAndCount(ScimGroup, where, {
      orderBy: { createdAt: 'asc' },
      limit: count,
      offset: Math.max(0, startIndex - 1),
    })
    const resources = await Promise.all(groups.map((group) => this.toResource(this.em, group, baseUrl)))
    return buildListResponse(resources, total, startIndex, resources.length)
  }

  async patchGroup(
    groupId: string,
    operations: ScimGroupPatchOperation[],
    scope: ScimScope,
    baseUrl: string,
  ): Promise<ScimGroupResource> {
    return this.em.transactional(async (transactionalEm) => {
      const group = await this.requireGroup(transactionalEm, groupId, scope)

      for (const operation of operations) {
        const path = operation.path?.trim().toLowerCase()
        if (path === 'displayname') {
          if (operation.op === 'remove') throw new ScimGroupServiceError(400, 'displayName cannot be removed')
          const displayName = typeof operation.value === 'string' ? operation.value.trim() : ''
          if (!displayName) throw new ScimGroupServiceError(400, 'displayName is required')
          group.displayName = displayName
          continue
        }
        if (path === 'externalid') {
          group.externalId = operation.op === 'remove' ? null : String(operation.value ?? '').trim() || null
          continue
        }
        if (!path && operation.value && typeof operation.value === 'object' && !Array.isArray(operation.value)) {
          const value = operation.value as Record<string, unknown>
          if (typeof value.displayName === 'string' && value.displayName.trim()) group.displayName = value.displayName.trim()
          if (typeof value.externalId === 'string') group.externalId = value.externalId.trim() || null
          if (Array.isArray(value.members)) {
            await this.applyMemberOperation(transactionalEm, group, operation.op, extractPatchMemberIds({ ...operation, value: value.members }), scope)
          }
          continue
        }
        if (path === 'members' || path?.startsWith('members[')) {
          await this.applyMemberOperation(transactionalEm, group, operation.op, extractPatchMemberIds(operation), scope)
        }
      }

      await transactionalEm.flush()
      await this.log(transactionalEm, scope, 'PATCH', group.id, group.externalId ?? null, 200)
      return this.toResource(transactionalEm, group, baseUrl)
    })
  }

  async deleteGroup(groupId: string, scope: ScimScope): Promise<void> {
    await this.em.transactional(async (transactionalEm) => {
      const group = await this.requireGroup(transactionalEm, groupId, scope)
      const affected = await transactionalEm.find(ScimGroupMember, {
        groupId: group.id,
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
      })
      const identityIds = affected.map((member) => member.identityId)
      await transactionalEm.nativeDelete(ScimGroupMember, {
        groupId: group.id,
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
      })
      transactionalEm.remove(group)
      await transactionalEm.flush()
      await this.syncIdentities(transactionalEm, identityIds, scope)
      await this.log(transactionalEm, scope, 'DELETE', group.id, group.externalId ?? null, 204)
    })
  }

  private async applyMemberOperation(
    em: EntityManager,
    group: ScimGroup,
    operation: ScimGroupPatchOperation['op'],
    memberIds: string[],
    scope: ScimScope,
  ): Promise<void> {
    if (operation !== 'remove' && memberIds.length === 0) {
      throw new ScimGroupServiceError(400, 'Group membership operation requires at least one member')
    }
    if (operation === 'replace') {
      await this.replaceMembers(em, group, memberIds, scope)
      return
    }

    const identities = await this.requireIdentities(em, memberIds, scope)
    if (operation === 'add') {
      const existing = await em.find(ScimGroupMember, {
        groupId: group.id,
        identityId: { $in: memberIds },
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
      })
      const existingIds = new Set(existing.map((member) => member.identityId))
      for (const identity of identities) {
        if (existingIds.has(identity.id)) continue
        em.persist(em.create(ScimGroupMember, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          ssoConfigId: scope.ssoConfigId,
          groupId: group.id,
          identityId: identity.id,
          userId: identity.userId,
        } as RequiredEntityData<ScimGroupMember>))
      }
      await em.flush()
      await this.syncIdentities(em, memberIds, scope)
      return
    }

    if (memberIds.length === 0) {
      const existing = await em.find(ScimGroupMember, {
        groupId: group.id,
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
      })
      const affectedIds = existing.map((member) => member.identityId)
      await em.nativeDelete(ScimGroupMember, {
        groupId: group.id,
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
      })
      await this.syncIdentities(em, affectedIds, scope)
      return
    }
    await em.nativeDelete(ScimGroupMember, {
      groupId: group.id,
      identityId: { $in: memberIds },
      ssoConfigId: scope.ssoConfigId,
      organizationId: scope.organizationId,
    })
    await this.syncIdentities(em, memberIds, scope)
  }

  private async replaceMembers(em: EntityManager, group: ScimGroup, memberIds: string[], scope: ScimScope): Promise<void> {
    const uniqueMemberIds = Array.from(new Set(memberIds))
    const identities = await this.requireIdentities(em, uniqueMemberIds, scope)
    const existing = await em.find(ScimGroupMember, {
      groupId: group.id,
      ssoConfigId: scope.ssoConfigId,
      organizationId: scope.organizationId,
    })
    const previousIds = existing.map((member) => member.identityId)
    await em.nativeDelete(ScimGroupMember, {
      groupId: group.id,
      ssoConfigId: scope.ssoConfigId,
      organizationId: scope.organizationId,
    })
    for (const identity of identities) {
      em.persist(em.create(ScimGroupMember, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        ssoConfigId: scope.ssoConfigId,
        groupId: group.id,
        identityId: identity.id,
        userId: identity.userId,
      } as RequiredEntityData<ScimGroupMember>))
    }
    await em.flush()
    await this.syncIdentities(em, Array.from(new Set([...previousIds, ...uniqueMemberIds])), scope)
  }

  private async requireIdentities(em: EntityManager, identityIds: string[], scope: ScimScope): Promise<SsoIdentity[]> {
    if (identityIds.length === 0) return []
    const identities = await em.find(SsoIdentity, {
      id: { $in: identityIds },
      ssoConfigId: scope.ssoConfigId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (identities.length !== new Set(identityIds).size) {
      throw new ScimGroupServiceError(400, 'One or more group members do not exist', 'invalidValue')
    }
    return identities
  }

  private async syncIdentities(em: EntityManager, identityIds: string[], scope: ScimScope): Promise<void> {
    for (const identityId of new Set(identityIds)) {
      const identity = await em.findOne(SsoIdentity, {
        id: identityId,
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!identity) continue

      const memberships = await em.find(ScimGroupMember, {
        identityId,
        ssoConfigId: scope.ssoConfigId,
        organizationId: scope.organizationId,
      })
      const groupIds = memberships.map((membership) => membership.groupId)
      const groups = groupIds.length > 0
        ? await em.find(ScimGroup, {
            id: { $in: groupIds },
            ssoConfigId: scope.ssoConfigId,
            organizationId: scope.organizationId,
          })
        : []
      identity.idpGroups = Array.from(new Set(groups.flatMap((group) => [group.externalId, group.displayName]).filter((value): value is string => !!value)))
      await em.flush()

      const user = await findOneWithDecryption(
        em,
        User,
        { id: identity.userId, organizationId: scope.organizationId, deletedAt: null },
        {},
        { tenantId: scope.tenantId ?? '', organizationId: scope.organizationId },
      )
      if (user) await syncSsoRoleGrants(em, user, scope.config, scope.tenantId ?? '', identity.idpGroups)
    }
  }

  private async toResource(em: EntityManager, group: ScimGroup, baseUrl: string): Promise<ScimGroupResource> {
    const members = await em.find(ScimGroupMember, {
      groupId: group.id,
      ssoConfigId: group.ssoConfigId,
      organizationId: group.organizationId,
    }, { orderBy: { createdAt: 'asc' } })
    return toScimGroupResource(group, members.map((member) => member.identityId), baseUrl)
  }

  private async requireGroup(em: EntityManager, groupId: string, scope: ScimScope): Promise<ScimGroup> {
    const group = await em.findOne(ScimGroup, {
      id: groupId,
      ssoConfigId: scope.ssoConfigId,
      organizationId: scope.organizationId,
    })
    if (!group) throw new ScimGroupServiceError(404, 'Group not found')
    return group
  }

  private async log(
    em: EntityManager,
    scope: ScimScope,
    operation: string,
    resourceId: string,
    externalId: string | null,
    responseStatus: number,
  ): Promise<void> {
    em.persist(em.create(ScimProvisioningLog, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ssoConfigId: scope.ssoConfigId,
      operation,
      resourceType: 'Group',
      resourceId,
      scimExternalId: externalId,
      responseStatus,
    } as RequiredEntityData<ScimProvisioningLog>))
    await em.flush()
  }
}

export class ScimGroupServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly scimType?: string,
  ) {
    super(message)
    this.name = 'ScimGroupServiceError'
  }
}
