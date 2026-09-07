import { expect, type APIRequestContext, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  extractOperation,
  redoOk,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['documents', 'customers', 'catalog', 'sales', 'audit_logs'],
}

type LinkItem = {
  id?: string
  entityType?: string
  entityId?: string | null
  label?: string
  href?: string | null
  canOpen?: boolean
  updatedAt?: string
}

type LinkList = { items?: LinkItem[] }
type Mutation = { id?: string; updatedAt?: string }

const PASSWORD = 'DocsLinks1!Pass'

async function createDocument(request: APIRequestContext, token: string, title: string) {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  const body = await readJsonSafe<Mutation>(response)
  expect(response.status()).toBe(201)
  return {
    id: expectId(body?.id, 'document id'),
    updatedAt: expectId(body?.updatedAt, 'document updatedAt'),
  }
}

async function createLink(
  request: APIRequestContext,
  token: string,
  documentId: string,
  input: { entityType: string; entityId: string; label: string; href: string },
) {
  const response = await apiRequest(request, 'POST', `/api/documents/${documentId}/links`, {
    token,
    data: { ...input, source: 'related-panel' },
  })
  return { response, body: await readJsonSafe<LinkItem>(response) }
}

async function listLinks(request: APIRequestContext, token: string, documentId: string): Promise<LinkItem[]> {
  const response = await apiRequest(request, 'GET', `/api/documents/${documentId}/links`, { token })
  const body = await readJsonSafe<LinkList>(response)
  expect(response.status()).toBe(200)
  return body?.items ?? []
}

async function deleteLink(
  request: APIRequestContext,
  token: string,
  documentId: string,
  link: LinkItem,
) {
  return request.fetch(`/api/documents/${documentId}/links/${link.id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      [OPTIMISTIC_LOCK_HEADER_NAME]: link.updatedAt!,
    },
  })
}

async function createScopedUser(
  request: APIRequestContext,
  adminToken: string,
  input: { stamp: number; label: string; features: string[]; organizationId: string },
) {
  const roleId = await createRoleFixture(request, adminToken, { name: `TC-DOCUMENTS-010 ${input.label} ${input.stamp}` })
  await setRoleAclFeatures(request, adminToken, { roleId, features: input.features, organizations: null })
  const email = `tc-documents-010-${input.label}-${input.stamp}@example.com`
  const id = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId: input.organizationId,
    roles: [roleId],
    name: `Documents 010 ${input.label}`,
  })
  return { id, roleId, token: await getAuthToken(request, email, PASSWORD) }
}

test.describe('TC-DOCUMENTS-010: links, redaction, reverse visibility, and undo', () => {
  test('round-trips typed targets without granting access and keeps link mutations reversible', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let documentId: string | null = null
    let documentUpdatedAt: string | null = null
    let personId: string | null = null
    let companyId: string | null = null
    let productId: string | null = null
    let orderId: string | null = null
    let restricted: Awaited<ReturnType<typeof createScopedUser>> | null = null
    let unshared: Awaited<ReturnType<typeof createScopedUser>> | null = null
    let restrictedShare: Mutation | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const scope = getTokenScope(adminToken)
      const document = await createDocument(request, adminToken, `TC-DOCUMENTS-010 ${stamp}`)
      documentId = document.id
      documentUpdatedAt = document.updatedAt
      companyId = await createCompanyFixture(request, adminToken, `Documents company ${stamp}`)
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'Linked',
        lastName: 'Person',
        displayName: `Linked Person ${stamp}`,
        companyEntityId: companyId,
      })
      productId = await createProductFixture(request, adminToken, {
        title: `Linked product ${stamp}`,
        sku: `DOC10-${stamp}`,
      })
      orderId = await createSalesOrderFixture(request, adminToken)

      const personInput = {
        entityType: 'customer-person',
        entityId: personId,
        label: `Linked Person ${stamp}`,
        href: `/backend/customers/people/${personId}`,
      }
      const [person, duplicate] = await Promise.all([
        createLink(request, adminToken, documentId, personInput),
        createLink(request, adminToken, documentId, personInput),
      ])
      expect([person.response.status(), duplicate.response.status()].sort()).toEqual([200, 201])
      expect(person.body).toMatchObject({ entityType: 'customer-person', entityId: personId, canOpen: true })
      expect(duplicate.body?.id).toBe(person.body?.id)
      const raceLoser = person.response.status() === 200 ? person.response : duplicate.response
      expect(
        extractOperation(raceLoser),
        'an idempotent race loser must not advertise an undo operation for a mutation it did not make',
      ).toBeNull()
      expect((await listLinks(request, adminToken, documentId)).some((item) => item.id === person.body?.id)).toBe(true)

      for (const target of [
        {
          entityType: 'product', entityId: productId, label: `Linked product ${stamp}`,
          href: `/backend/catalog/products/${productId}`,
        },
        {
          entityType: 'sales-order', entityId: orderId, label: `Order ${stamp}`,
          href: `/backend/sales/orders/${orderId}`,
        },
      ]) {
        const created = await createLink(request, adminToken, documentId, target)
        expect(created.response.status(), `link ${target.entityType}`).toBe(201)
        expect(created.body).toMatchObject({ entityType: target.entityType, entityId: target.entityId, href: target.href })
      }

      const reverse = await apiRequest(
        request,
        'GET',
        `/api/documents?entityType=customer-person&entityId=${personId}&page=1&pageSize=20`,
        { token: adminToken },
      )
      const reverseBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(reverse)
      expect(reverse.status()).toBe(200)
      expect(reverseBody?.items?.some((item) => item.id === documentId)).toBe(true)

      restricted = await createScopedUser(request, adminToken, {
        stamp,
        label: 'restricted',
        organizationId: scope.organizationId,
        features: ['documents.view', 'documents.edit', 'customers.companies.view'],
      })
      const shareResponse = await apiRequest(request, 'POST', `/api/documents/${documentId}/shares`, {
        token: adminToken,
        data: { principalType: 'user', principalId: restricted.id, permission: 'editor' },
      })
      restrictedShare = await readJsonSafe<Mutation>(shareResponse)
      expect(shareResponse.status()).toBe(201)

      const restrictedCompanyLink = await createLink(request, restricted.token, documentId, {
        entityType: 'customer-company',
        entityId: companyId,
        label: `Documents company ${stamp}`,
        href: `/backend/customers/companies/${companyId}`,
      })
      expect(restrictedCompanyLink.response.status()).toBe(201)
      const restrictedCompanyOperation = expectOperation(
        restrictedCompanyLink.response,
        'restricted company link create',
      )
      await setRoleAclFeatures(request, adminToken, {
        roleId: restricted.roleId,
        features: ['documents.view', 'documents.edit'],
        organizations: null,
      })
      const revokedUndo = await undoByToken(
        request,
        restricted.token,
        restrictedCompanyOperation.undoToken,
      )
      expect(revokedUndo.ok(), 'link undo must re-check the current target feature grant').toBe(false)
      expect((await listLinks(request, adminToken, documentId)).some(
        (item) => item.id === restrictedCompanyLink.body?.id,
      )).toBe(true)

      const ownCommentResponse = await apiRequest(request, 'POST', `/api/documents/${documentId}/comments`, {
        token: restricted.token,
        data: { body: `Restricted author ${stamp}`, parentCommentId: null },
      })
      const ownComment = await readJsonSafe<Mutation>(ownCommentResponse)
      expect(ownCommentResponse.status()).toBe(201)
      const ownerCommentResponse = await apiRequest(request, 'POST', `/api/documents/${documentId}/comments`, {
        token: adminToken,
        data: { body: `Owner author ${stamp}`, parentCommentId: null },
      })
      const ownerComment = await readJsonSafe<Mutation>(ownerCommentResponse)
      expect(ownerCommentResponse.status()).toBe(201)

      const downgradeShare = await request.fetch(`/api/documents/${documentId}/shares`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          [OPTIMISTIC_LOCK_HEADER_NAME]: restrictedShare?.updatedAt ?? '',
        },
        data: { id: restrictedShare?.id, permission: 'viewer' },
      })
      restrictedShare = await readJsonSafe<Mutation>(downgradeShare)
      expect(downgradeShare.status()).toBe(200)

      const commentsResponse = await apiRequest(request, 'GET', `/api/documents/${documentId}/comments`, {
        token: restricted.token,
      })
      const comments = await readJsonSafe<{ items?: Array<{ id?: string; canResolve?: boolean }> }>(commentsResponse)
      expect(commentsResponse.status()).toBe(200)
      expect(comments?.items?.find((comment) => comment.id === ownComment?.id)?.canResolve).toBe(true)
      expect(comments?.items?.find((comment) => comment.id === ownerComment?.id)?.canResolve).toBe(false)

      const redacted = await listLinks(request, restricted.token, documentId)
      expect(redacted).not.toHaveLength(0)
      expect(redacted.every((item) => item.entityId === null && item.href === null && item.canOpen === false)).toBe(true)
      expect(redacted.every((item) => item.label && !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(item.label))).toBe(true)

      const rejectedProbe = await createLink(request, restricted.token, documentId, {
        entityType: 'customer-person',
        entityId: personId,
        label: 'Probe',
        href: `/backend/customers/people/${personId}`,
      })
      expect(rejectedProbe.response.status()).toBe(403)

      unshared = await createScopedUser(request, adminToken, {
        stamp,
        label: 'unshared',
        organizationId: scope.organizationId,
        features: ['documents.view', 'customers.people.view'],
      })
      const deniedDetail = await apiRequest(request, 'GET', `/api/documents/${documentId}`, { token: unshared.token })
      expect([403, 404]).toContain(deniedDetail.status())
      const hiddenReverse = await apiRequest(
        request,
        'GET',
        `/api/documents?entityType=customer-person&entityId=${personId}&page=1&pageSize=20`,
        { token: unshared.token },
      )
      const hiddenReverseBody = await readJsonSafe<{ items?: unknown[] }>(hiddenReverse)
      expect(hiddenReverse.status()).toBe(200)
      expect(hiddenReverseBody?.items ?? []).toHaveLength(0)

      const activePerson = (await listLinks(request, adminToken, documentId))
        .find((item) => item.entityType === 'customer-person')!
      const staleDelete = await request.fetch(`/api/documents/${documentId}/links/${activePerson.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          [OPTIMISTIC_LOCK_HEADER_NAME]: new Date(Date.parse(activePerson.updatedAt!) - 1000).toISOString(),
        },
      })
      expect(staleDelete.status()).toBe(409)

      const deleted = await deleteLink(request, adminToken, documentId, activePerson)
      expect(deleted.status()).toBe(200)
      const operation = expectOperation(deleted, 'delete document link')
      await undoOk(request, adminToken, operation.undoToken, 'restore document link')
      expect((await listLinks(request, adminToken, documentId)).some((item) => item.id === activePerson.id)).toBe(true)
      await redoOk(request, adminToken, operation.logId, 're-delete document link')
      expect((await listLinks(request, adminToken, documentId)).some((item) => item.id === activePerson.id)).toBe(false)
    } finally {
      if (adminToken && documentId) {
        for (const link of await listLinks(request, adminToken, documentId).catch(() => [])) {
          await deleteLink(request, adminToken, documentId, link).catch(() => undefined)
        }
        if (restrictedShare?.id && restrictedShare.updatedAt) {
          await request.fetch(`/api/documents/${documentId}/shares`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
              [OPTIMISTIC_LOCK_HEADER_NAME]: restrictedShare.updatedAt,
            },
            data: { id: restrictedShare.id },
          }).catch(() => undefined)
        }
        await request.fetch(`/api/documents/${documentId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            ...(documentUpdatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: documentUpdatedAt } : {}),
          },
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, adminToken, restricted?.id ?? null)
      await deleteRoleIfExists(request, adminToken, restricted?.roleId ?? null)
      await deleteUserIfExists(request, adminToken, unshared?.id ?? null)
      await deleteRoleIfExists(request, adminToken, unshared?.roleId ?? null)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
    }
  })
})
