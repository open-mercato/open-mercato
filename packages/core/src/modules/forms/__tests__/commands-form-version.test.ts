/**
 * Unit-level invariants for the form-version commands. The commands talk to
 * MikroORM, the typed event bus, and the cache through DI. To keep these
 * tests focused on logic (not infra), the tests stub the runtime container
 * and EntityManager.
 *
 * The full integration story (DB-backed CRUD + concurrency/locking) lives in
 * the integration-test phase; this file pins down the invariants flagged in
 * the spec — fork rejects on existing draft, update rejects on non-draft,
 * publish rejects no-op, publish advances the form pointer.
 */

import 'reflect-metadata'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

// Mocks — register before importing the commands so registerCommand is a no-op.
jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: jest.fn(),
}))

jest.mock('../events', () => ({
  emitFormsEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../events-payloads', () => ({
  formsEventPayloadSchemas: {
    'forms.form_version.published': { parse: (p: unknown) => p },
    'forms.form.created': { parse: (p: unknown) => p },
    'forms.form.archived': { parse: (p: unknown) => p },
  },
}))

const ACTOR_USER_ID = '00000000-0000-4000-8000-000000000001'

import {
  forkDraftCommand,
  publishVersionCommand,
  updateDraftCommand,
} from '../commands/form-version'

type StoredVersion = {
  id: string
  formId: string
  organizationId: string
  tenantId: string
  versionNumber: number
  status: 'draft' | 'published' | 'archived'
  schema: Record<string, unknown>
  uiSchema: Record<string, unknown>
  roles: string[]
  schemaHash: string
  registryVersion: string
  publishedAt: Date | null
  publishedBy: string | null
  changelog: string | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type StoredForm = {
  id: string
  organizationId: string
  tenantId: string
  status: 'draft' | 'active' | 'archived'
  currentPublishedVersionId: string | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

function buildStubContainer() {
  const forms = new Map<string, StoredForm>()
  const versions = new Map<string, StoredVersion>()

  const em = {
    fork() { return em },
    async findOne<T>(target: unknown, where: Record<string, unknown>): Promise<T | null> {
      const targetName = (target as { name?: string }).name ?? ''
      if (targetName === 'Form') {
        const all = Array.from(forms.values())
        return (all.find((entry) => matchWhere(entry, where)) ?? null) as T | null
      }
      if (targetName === 'FormVersion') {
        const all = Array.from(versions.values())
        if (where.orderBy) {
          // not used in our paths
        }
        return (all.find((entry) => matchWhere(entry, where)) ?? null) as T | null
      }
      return null
    },
    create<T>(_target: unknown, fields: T): T {
      return { ...fields, id: fields && (fields as { id?: string }).id ? (fields as { id: string }).id : `entity-${forms.size + versions.size + 1}` } as T
    },
    persist(entity: unknown) {
      const target = (entity as { __type?: string }).__type
      const id = (entity as { id?: string }).id ?? `entity-${forms.size + versions.size + 1}`
      const stored = { ...(entity as object) } as { id?: string }
      stored.id = id
      if (target === 'Form' || (entity as StoredForm).currentPublishedVersionId !== undefined) {
        forms.set(id, stored as StoredForm)
      } else if ((entity as StoredVersion).versionNumber !== undefined) {
        versions.set(id, stored as StoredVersion)
      }
    },
    remove() {},
    async flush() {},
    async transactional<T>(fn: (em: typeof em) => Promise<T>): Promise<T> {
      return fn(em)
    },
    getKysely() {
      function makeBuilder(table: string, predicates: Array<{ col: string; value: unknown }> = []) {
        return {
          select() { return makeBuilder(table, predicates) },
          where(col: string, _op: string, value: unknown) {
            return makeBuilder(table, [...predicates, { col, value }])
          },
          forUpdate() { return makeBuilder(table, predicates) },
          limit() { return makeBuilder(table, predicates) },
          async execute() {
            if (table === 'information_schema.tables') return []
            if (table === 'forms_form_version') {
              const idPred = predicates.find((entry) => entry.col === 'id')
              if (!idPred) return []
              const v = versions.get(idPred.value as string)
              if (!v) return []
              return [{ id: v.id, status: v.status, schema_hash: v.schemaHash, form_id: v.formId }]
            }
            if (table === 'forms_form_submission') return []
            return []
          },
        }
      }
      return {
        selectFrom(name: string) { return makeBuilder(name) },
      }
    },
  }

  function matchWhere(entry: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (value === null) {
        if (entry[key] !== null && entry[key] !== undefined) return false
      } else if (entry[key] !== value) {
        return false
      }
    }
    return true
  }

  const container = {
    resolve(name: string) {
      if (name === 'em') return em
      if (name === 'commandBus') return { execute: async () => ({ result: undefined, logEntry: null }) }
      if (name === 'cacheService') return { deleteByTags: async () => 0 }
      if (name === 'formVersionCompiler') {
        return {
          compile: ({ id, schema }: { id: string; schema: Record<string, unknown> }) => ({
            schemaHash: `hash:${id}:${JSON.stringify(schema).length}`,
            ajv: () => true,
            zod: { _def: {} },
            fieldIndex: {},
            rolePolicyLookup: () => ({ canRead: true, canWrite: true }),
            registryVersion: '1',
          }),
        }
      }
      if (name === 'fieldTypeRegistry') {
        return { getRegistryVersion: () => '1' }
      }
      throw new Error(`unknown DI key: ${name}`)
    },
  }

  return { container, forms, versions }
}

function buildCtx(stub: ReturnType<typeof buildStubContainer>) {
  return {
    container: stub.container,
    auth: { sub: ACTOR_USER_ID, tenantId: '00000000-0000-4000-8000-bbbbbbbbbbbb', orgId: '00000000-0000-4000-8000-aaaaaaaaaaaa', isApiKey: false } as unknown,
    organizationScope: null,
    selectedOrganizationId: '00000000-0000-4000-8000-aaaaaaaaaaaa',
    organizationIds: ['00000000-0000-4000-8000-aaaaaaaaaaaa'],
  } as unknown as Parameters<typeof updateDraftCommand.execute>[1]
}

function makeForm(stub: ReturnType<typeof buildStubContainer>, id: string): StoredForm {
  const form: StoredForm = {
    id,
    organizationId: '00000000-0000-4000-8000-aaaaaaaaaaaa',
    tenantId: '00000000-0000-4000-8000-bbbbbbbbbbbb',
    status: 'draft',
    currentPublishedVersionId: null,
    archivedAt: null,
    createdAt: new Date('2026-05-01'),
    updatedAt: new Date('2026-05-01'),
    deletedAt: null,
  }
  stub.forms.set(id, form)
  return form
}

function makeVersion(stub: ReturnType<typeof buildStubContainer>, overrides: Partial<StoredVersion> & Pick<StoredVersion, 'id' | 'formId'>): StoredVersion {
  const version: StoredVersion = {
    id: overrides.id,
    formId: overrides.formId,
    organizationId: '00000000-0000-4000-8000-aaaaaaaaaaaa',
    tenantId: '00000000-0000-4000-8000-bbbbbbbbbbbb',
    versionNumber: overrides.versionNumber ?? 1,
    status: overrides.status ?? 'draft',
    schema: overrides.schema ?? { type: 'object', properties: {} },
    uiSchema: overrides.uiSchema ?? {},
    roles: overrides.roles ?? [],
    schemaHash: overrides.schemaHash ?? 'hash-original',
    registryVersion: overrides.registryVersion ?? '1',
    publishedAt: overrides.publishedAt ?? null,
    publishedBy: overrides.publishedBy ?? null,
    changelog: overrides.changelog ?? null,
    archivedAt: overrides.archivedAt ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-05-01'),
    updatedAt: overrides.updatedAt ?? new Date('2026-05-01'),
  }
  stub.versions.set(version.id, version)
  return version
}

describe('forms.form_version commands', () => {
  it('forms.form_version.fork_draft rejects when a draft already exists', async () => {
    const stub = buildStubContainer()
    const ctx = buildCtx(stub)
    makeForm(stub, '11111111-1111-4111-8111-111111111111')
    makeVersion(stub, { id: '22222222-2222-4222-8222-222222222222', formId: '11111111-1111-4111-8111-111111111111', status: 'draft' })

    await expect(
      forkDraftCommand.execute({
        tenantId: '00000000-0000-4000-8000-bbbbbbbbbbbb',
        organizationId: '00000000-0000-4000-8000-aaaaaaaaaaaa',
        formId: '11111111-1111-4111-8111-111111111111',
      } as never, ctx as never),
    ).rejects.toMatchObject({
      status: 422,
      body: { error: 'forms.errors.draft_already_exists' },
    })
  })

  it('forms.form_version.update_draft rejects when status != draft', async () => {
    const stub = buildStubContainer()
    const ctx = buildCtx(stub)
    makeForm(stub, '11111111-1111-4111-8111-111111111111')
    const version = makeVersion(stub, {
      id: '33333333-3333-4333-8333-333333333333',
      formId: '11111111-1111-4111-8111-111111111111',
      status: 'published',
      schemaHash: 'frozen-hash',
    })
    expect(version.status).toBe('published')

    await expect(
      updateDraftCommand.execute({
        tenantId: '00000000-0000-4000-8000-bbbbbbbbbbbb',
        organizationId: '00000000-0000-4000-8000-aaaaaaaaaaaa',
        formId: '11111111-1111-4111-8111-111111111111',
        versionId: '33333333-3333-4333-8333-333333333333',
        schema: { type: 'object', properties: { foo: { type: 'string', 'x-om-type': 'text' } } },
      } as never, ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'forms.errors.version_is_frozen' },
    })
  })

  it('forms.form_version.publish rejects no-op when schema_hash matches previous published', async () => {
    const stub = buildStubContainer()
    const ctx = buildCtx(stub)
    const formId = '11111111-1111-4111-8111-111111111111'
    const previousId = '44444444-4444-4444-8444-444444444444'
    const draftId = '55555555-5555-4555-8555-555555555555'

    const form = makeForm(stub, formId)
    form.currentPublishedVersionId = previousId
    form.status = 'active'

    const sharedSchema = { type: 'object', properties: { same: { type: 'string', 'x-om-type': 'text' } } }
    const sharedUiSchema = {}
    // Both versions resolve to the same hash (the stub compiler hashes by content length).
    makeVersion(stub, {
      id: previousId,
      formId,
      status: 'published',
      schema: sharedSchema,
      uiSchema: sharedUiSchema,
      schemaHash: `hash:${previousId}:${JSON.stringify(sharedSchema).length}`,
    })
    makeVersion(stub, {
      id: draftId,
      formId,
      status: 'draft',
      schema: sharedSchema,
      uiSchema: sharedUiSchema,
      schemaHash: 'irrelevant',
    })

    // Override the stub compiler so both versions yield the SAME hash.
    const realResolve = stub.container.resolve.bind(stub.container)
    stub.container.resolve = ((name: string) => {
      if (name === 'formVersionCompiler') {
        return {
          compile: () => ({
            schemaHash: 'identical-hash',
            ajv: () => true,
            zod: { _def: {} },
            fieldIndex: {},
            rolePolicyLookup: () => ({ canRead: true, canWrite: true }),
            registryVersion: '1',
          }),
        }
      }
      return realResolve(name)
    }) as typeof stub.container.resolve

    // The previously-published row also needs that identical-hash.
    const prev = stub.versions.get(previousId)!
    prev.schemaHash = 'identical-hash'

    await expect(
      publishVersionCommand.execute({
        tenantId: '00000000-0000-4000-8000-bbbbbbbbbbbb',
        organizationId: '00000000-0000-4000-8000-aaaaaaaaaaaa',
        formId,
        versionId: draftId,
      } as never, ctx as never),
    ).rejects.toMatchObject({
      status: 422,
      body: { error: 'forms.errors.no_op_publish' },
    })
  })

  it('forms.form_version.publish advances current_published_version_id and emits event', async () => {
    const stub = buildStubContainer()
    const ctx = buildCtx(stub)
    const formId = '11111111-1111-4111-8111-111111111111'
    const draftId = '66666666-6666-4666-8666-666666666666'

    const form = makeForm(stub, formId)
    expect(form.currentPublishedVersionId).toBeNull()

    makeVersion(stub, {
      id: draftId,
      formId,
      status: 'draft',
      schema: { type: 'object', properties: { same: { type: 'string', 'x-om-type': 'text' } } },
      schemaHash: 'fresh',
    })

    const result = await publishVersionCommand.execute({
      tenantId: '00000000-0000-4000-8000-bbbbbbbbbbbb',
      organizationId: '00000000-0000-4000-8000-aaaaaaaaaaaa',
      formId,
      versionId: draftId,
      changelog: 'first publish',
    } as never, ctx as never)

    expect(result.versionId).toBe(draftId)
    const stored = stub.versions.get(draftId)
    expect(stored?.status).toBe('published')
    expect(stored?.publishedBy).toBe(ACTOR_USER_ID)
    expect(form.currentPublishedVersionId).toBe(draftId)
    expect(form.status).toBe('active')

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { emitFormsEvent } = require('../events') as { emitFormsEvent: jest.Mock }
    expect(emitFormsEvent).toHaveBeenCalledWith(
      'forms.form_version.published',
      expect.objectContaining({
        formId,
        versionId: draftId,
        publishedBy: ACTOR_USER_ID,
      }),
    )
  })
})

describe('forms.form_version commands type integrity', () => {
  it('CrudHttpError is the canonical error type', () => {
    const error = new CrudHttpError(422, { error: 'x' })
    expect(error.status).toBe(422)
  })
})
