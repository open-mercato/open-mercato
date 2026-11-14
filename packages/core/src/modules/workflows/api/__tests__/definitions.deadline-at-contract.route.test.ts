/**
 * #7181 review — the definition routes keep their published response contract
 * for an absolute user-task deadline.
 *
 * An author writes `userTaskConfig.deadlineAt` through POST and PUT; a client
 * built against the existing OpenAPI keeps reading through GET list, GET by id
 * and the mutation responses. Every one of those serialized bodies must still
 * parse with the response schemas those routes have always documented, so the
 * absolute deadline travels as the optional sibling `deadlineAt` and never as an
 * `at`-only `deadline` (whose legacy contract requires a `duration`).
 */

import { NextRequest } from 'next/server'
import { GET as listDefinitions, POST as createDefinition } from '../definitions/route'
import { GET as getDefinition, PUT as updateDefinition } from '../definitions/[id]/route'
import {
  workflowDefinitionDetailResponseSchema,
  workflowDefinitionListResponseSchema,
  workflowDefinitionMutationResponseSchema,
} from '../openapi'
import { clearCodeWorkflowRegistry } from '../../lib/code-registry'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/auth/lib/executionPrincipal', () => ({
  normalizeFeatureList: (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [],
  provisionExecutionPrincipal: jest.fn(async () => ({ userId: 'principal-user', roleId: 'principal-role' })),
  resolveExecutionPrincipalUserId: jest.fn(async () => null),
}))

const tenantId = 'test-tenant-id'
const organizationId = 'test-org-id'
const userId = 'test-user-id'

type StoredRow = Record<string, unknown> & { id: string }

function userTaskDefinition(userTaskConfig: Record<string, unknown>) {
  return {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      {
        stepId: 'review',
        stepName: 'Review',
        stepType: 'USER_TASK',
        userTaskConfig: { assignedTo: 'clerk@example.com', ...userTaskConfig },
      },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 't1', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
      { transitionId: 't2', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
    ],
  }
}

function reviewConfig(body: { definition: { steps: Array<{ stepId: string; userTaskConfig?: unknown }> } }) {
  return body.definition.steps.find((step) => step.stepId === 'review')?.userTaskConfig as
    | Record<string, unknown>
    | undefined
}

describe('definition routes: an absolute deadline keeps the published response contract', () => {
  let rows: StoredRow[]

  beforeEach(() => {
    clearCodeWorkflowRegistry()
    rows = []
    const em = {
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(function persist(this: unknown, row: StoredRow) {
        if (!rows.includes(row)) rows.push(row)
        return this
      }),
      flush: jest.fn(async () => undefined),
      findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
        typeof where.id === 'string' ? rows.find((row) => row.id === where.id) ?? null : null,
      ),
      find: jest.fn(async () => rows),
      count: jest.fn(async () => rows.length),
    }
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') {
          return {
            userHasAllFeatures: jest.fn().mockResolvedValue(true),
            getGrantedFeatures: jest.fn().mockResolvedValue(['*']),
          }
        }
        return null
      }),
    }
    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue(container)
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    const { resolveOrganizationScopeForRequest } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: organizationId })
  })

  async function create(definition: unknown) {
    const response = await createDefinition(
      new NextRequest('http://localhost/api/workflows/definitions', {
        method: 'POST',
        body: JSON.stringify({ workflowId: 'deeds', workflowName: 'Deeds', definition }),
      }),
    )
    return { status: response.status, body: await response.json() }
  }

  async function update(id: string, definition: unknown) {
    const response = await updateDefinition(
      new NextRequest(`http://localhost/api/workflows/definitions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ definition }),
      }),
      { params: Promise.resolve({ id }) },
    )
    return { status: response.status, body: await response.json() }
  }

  async function readList() {
    const response = await listDefinitions(new NextRequest('http://localhost/api/workflows/definitions'))
    return { status: response.status, body: await response.json() }
  }

  async function readOne(id: string) {
    const response = await getDefinition(
      new NextRequest(`http://localhost/api/workflows/definitions/${id}`),
      { params: Promise.resolve({ id }) },
    )
    return { status: response.status, body: await response.json() }
  }

  test('POST, PUT, GET list and GET by id all parse with the existing response schemas', async () => {
    const created = await create(userTaskDefinition({ deadlineAt: '{{context.dueDate}}' }))
    expect(created.status).toBe(201)
    expect(workflowDefinitionMutationResponseSchema.safeParse(created.body).success).toBe(true)
    expect(reviewConfig(created.body.data)).toMatchObject({ deadlineAt: '{{context.dueDate}}' })
    expect(reviewConfig(created.body.data)).not.toHaveProperty('deadline')
    const id = created.body.data.id as string

    const updated = await update(id, userTaskDefinition({ deadlineAt: '2026-12-31T17:00:00+01:00' }))
    expect(updated.status).toBe(200)
    expect(workflowDefinitionMutationResponseSchema.safeParse(updated.body).success).toBe(true)
    expect(reviewConfig(updated.body.data)).toMatchObject({ deadlineAt: '2026-12-31T17:00:00+01:00' })

    const list = await readList()
    expect(list.status).toBe(200)
    const listParse = workflowDefinitionListResponseSchema.safeParse(list.body)
    expect(listParse.success).toBe(true)
    expect(list.body.data).toHaveLength(1)
    expect(reviewConfig(list.body.data[0])).toMatchObject({ deadlineAt: '2026-12-31T17:00:00+01:00' })

    const detail = await readOne(id)
    expect(detail.status).toBe(200)
    expect(workflowDefinitionDetailResponseSchema.safeParse(detail.body).success).toBe(true)
    expect(reviewConfig(detail.body.data)).toMatchObject({ deadlineAt: '2026-12-31T17:00:00+01:00' })
  })

  test('an at-only `deadline` is refused on POST and PUT, so it is never stored or served', async () => {
    const refusedCreate = await create(userTaskDefinition({ deadline: { at: '{{context.dueDate}}' } }))
    expect(refusedCreate.status).toBe(400)
    expect(rows).toHaveLength(0)

    const created = await create(userTaskDefinition({ deadline: { duration: 'P3D' } }))
    expect(created.status).toBe(201)
    const id = created.body.data.id as string

    const refusedUpdate = await update(id, userTaskDefinition({ deadline: { at: '2026-12-31' } }))
    expect(refusedUpdate.status).toBe(400)
    expect(reviewConfig(rows[0] as never)).toMatchObject({ deadline: { duration: 'P3D' } })

    const list = await readList()
    expect(workflowDefinitionListResponseSchema.safeParse(list.body).success).toBe(true)
  })

  test('declaring both `deadline` and `deadlineAt` is refused with the localized-key diagnostic', async () => {
    const refused = await create(
      userTaskDefinition({ deadline: { duration: 'P3D' }, deadlineAt: '{{context.dueDate}}' }),
    )
    expect(refused.status).toBe(400)
    const issue = (refused.body.details as Array<{ path: Array<string | number>; message: string }>).find(
      (detail) => detail.path.join('.').endsWith('userTaskConfig.deadlineAt'),
    )
    expect(issue?.message).toContain('not both')
    expect(rows).toHaveLength(0)
  })
})
