import { z } from 'zod'
import { defineCrudRouteSectionHost } from '@open-mercato/shared/lib/crud/form-sections/derived-route-host'
import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'
import { add, defineCrudFormExtension, field, hide, modify, replace, store } from '@open-mercato/ui/backend/crud-form-extensions'
import { todoCrudRoute } from './api/todos/route'
import { exampleCreatedSchema, exampleOkSchema } from './api/openapi'
import { todoNotesSchema } from './data/validators'
import { exampleExternalErpDelivery } from './lib/exampleExternalErp'

const projected = z.strictObject({
  title: z.string().min(1).max(200).optional(),
  is_done: z.boolean().optional(),
  notes: todoNotesSchema.optional(),
  customFields: z.strictObject({
    priority: z.number().int().min(1).max(5).optional(),
    severity: z.enum(['low', 'medium', 'high']).optional(),
    season: z.enum(['spring', 'summer', 'autumn', 'winter']).optional(),
  }).optional(),
})

const authoritative = projected.extend({
  title: z.string().min(1).max(200),
  is_done: z.boolean(),
  id: z.uuid().optional(),
  expected_updated_at: z.iso.datetime().optional(),
})

const updateProof = {
  finalInput: 'transactional-final-input/v1',
  atomicity: 'pessimistic-write',
  contenderCoverage: ['update/update', 'update/delete'],
  extensionSinkSupport: 'host-transaction',
} as const

export const crudFormSections = defineCrudFormSections({
  hostFacts: [
    {
      id: 'example.todo-showcase-create',
      roundTripId: 'example.todo-showcase-create@v3',
      hostResourceKind: 'example.todo',
      customFieldSeedEntities: { 'example.todo-showcase-fields': 'example:todo' },
      alternatives: [{
        surface: {
          id: 'example.todo-showcase-create.base',
          hostId: 'example.todo', formVariant: 'showcase', formOperation: 'create',
          orderedSectionIds: ['title', 'details', 'status'], callerIds: [], contributionIds: [],
          ownershipFacts: [
            { sectionId: 'title', payloadPaths: ['title'], customFieldOwnership: { mode: 'none' } },
            { sectionId: 'details', payloadPaths: ['notes'], customFieldOwnership: { mode: 'ids', ids: ['priority', 'severity'], definitionSetId: 'example.todo-showcase-fields' } },
            { sectionId: 'status', payloadPaths: ['is_done'], customFieldOwnership: { mode: 'none' } },
          ],
          mutationSurfaceIds: [], dependencies: [],
        },
        requiredSectionLeaves: [{ sectionId: 'title', payloadPath: 'title' }, { sectionId: 'status', payloadPath: 'is_done' }],
        requiredLeafLabelKeys: { title: 'example.todos.form.fields.title.label', is_done: 'example.todos.form.fields.isDone.label' },
      }],
    },
    {
      id: 'example.todo-showcase-update',
      roundTripId: 'example.todo-showcase-update@v3',
      hostResourceKind: 'example.todo',
      customFieldSeedEntities: { 'example.todo-showcase-fields': 'example:todo' },
      alternatives: [{
        surface: {
          id: 'example.todo-showcase-update.base',
          hostId: 'example.todo', formVariant: 'showcase', formOperation: 'update',
          orderedSectionIds: ['title', 'details', 'status'], callerIds: [], contributionIds: [],
          ownershipFacts: [
            { sectionId: 'title', payloadPaths: ['title'], customFieldOwnership: { mode: 'none' } },
            { sectionId: 'details', payloadPaths: ['notes'], customFieldOwnership: { mode: 'ids', ids: ['priority', 'severity'], definitionSetId: 'example.todo-showcase-fields' } },
            { sectionId: 'status', payloadPaths: ['is_done'], customFieldOwnership: { mode: 'none' } },
          ],
          mutationSurfaceIds: [], dependencies: [],
        },
        requiredSectionLeaves: [{ sectionId: 'title', payloadPath: 'title' }, { sectionId: 'status', payloadPath: 'is_done' }],
        requiredLeafLabelKeys: { title: 'example.todos.form.fields.title.label', is_done: 'example.todos.form.fields.isDone.label' },
      }],
    },
  ],
  derivedHosts: [
    defineCrudRouteSectionHost({
      hostId: 'example.todo', formVariant: 'showcase', formOperation: 'create',
      hostDescriptorId: 'example.todo-showcase-create',
      route: todoCrudRoute,
      sections: [{ id: 'title', writes: 'parent' }, { id: 'details', writes: 'parent' }, { id: 'status', writes: 'parent' }],
      authoritativeSchema: { id: 'example.todo-showcase-create.schema', schema: authoritative, fixtures: [{ title: 'Example', is_done: false }] },
      projectedSchema: projected,
      submit: { proof: { finalInput: 'transactional-final-input/v1', extensionSinkSupport: 'host-transaction' } },
      extensionSinkSupport: 'host-transaction',
      maxBodyBytes: 32_768,
      responseSchemas: { POST: exampleCreatedSchema },
    }),
    defineCrudRouteSectionHost({
      hostId: 'example.todo', formVariant: 'showcase', formOperation: 'update',
      hostDescriptorId: 'example.todo-showcase-update',
      route: todoCrudRoute,
      sections: [{ id: 'title', writes: 'parent' }, { id: 'details', writes: 'parent' }, { id: 'status', writes: 'parent' }],
      authoritativeSchema: { id: 'example.todo-showcase-update.schema', schema: authoritative, fixtures: [{ title: 'Example', is_done: false }] },
      projectedSchema: projected,
      submit: { proof: updateProof },
      delete: { proof: updateProof, mode: 'hard' },
      outboxRetry: true,
      expectedVersionField: 'expected_updated_at',
      wireRequiredUpdatePaths: ['is_done', 'title'],
      mergesOmittedFieldsFromLockedRecord: true,
      projectLockedRecord: (record) => ({ title: record.title, is_done: record.isDone }),
      extensionSinkSupport: 'host-transaction',
      maxBodyBytes: 32_768,
      responseSchemas: { PUT: exampleOkSchema, DELETE: exampleOkSchema },
    }),
  ],
  runtimes: [
    { id: 'example.todo-showcase-create', roundTripId: 'example.todo-showcase-create@v3', load: lazyCrudFormSectionRuntime(() => import('./todo-showcase-create.client')) },
    { id: 'example.todo-showcase-update', roundTripId: 'example.todo-showcase-update@v3', load: lazyCrudFormSectionRuntime(() => import('./todo-showcase-update.client')) },
  ],
})

export const crudFormExtensions = [defineCrudFormExtension({
  id: 'example.todo-extensions',
  host: 'crud-form:example.todo',
  targets: [
    { formVariant: 'showcase', formOperation: 'create' },
    { formVariant: 'showcase', formOperation: 'update' },
  ],
  sections: {
    title: hide(),
    details: modify({ fields: {
      notes: field.remove(),
      cf_priority: field.patch({
        labelKey: 'example.todoShowcase.fields.priority',
        validate: {
          server: (value, { scope }) => scope.organizationId && value !== 5 ? true : 'example.todoShowcase.errors.priority',
        },
      }),
    } }),
    status: replace(() => import('./todo-showcase-status.client')),
    season: add({
      after: 'details', titleKey: 'example.todoShowcase.groups.season',
      fields: {
        cf_season: field.add({
          type: 'select', labelKey: 'example.todoShowcase.fields.season', store: store.customField('season'),
          options: [
            { value: 'spring', labelKey: 'example.todoShowcase.seasons.spring' },
            { value: 'summer', labelKey: 'example.todoShowcase.seasons.summer' },
            { value: 'autumn', labelKey: 'example.todoShowcase.seasons.autumn' },
            { value: 'winter', labelKey: 'example.todoShowcase.seasons.winter' },
          ],
        }),
      },
    }),
    brand: add({
      after: 'status', titleKey: 'example.todoShowcase.groups.brand', store: store.table('example:todo_brand'),
      fields: {
        brand: field.add({ type: 'text', labelKey: 'example.todoShowcase.fields.brand' }),
      },
    }),
    observer: add({
      after: 'status', titleKey: 'example.todoShowcase.groups.observer',
      store: store.sink({
        entityId: 'example:todo', atomicity: 'after-commit', optimisticLock: 'none', undoMode: 'unsupported', appendOnly: true,
        schema: z.strictObject({ observerNote: z.string().max(200).nullable().optional() }),
        persist: async ({ values }) => {
          if (values.observerNote === 'unavailable') throw new Error('[internal] Example observer unavailable')
          return { before: null, after: null }
        },
        load: async () => null,
      }),
      fields: {
        observerNote: field.add({ type: 'text', labelKey: 'example.todoShowcase.fields.observer' }),
      },
    }),
    erp: add({
      after: 'status', titleKey: 'example.todoShowcase.groups.erp',
      store: store.external({
        integrationId: 'example_todo_erp', mirror: 'example:todo_erp_link',
        contractId: 'example:todo_erp_link@v1',
        deliver: exampleExternalErpDelivery.deliver,
        validateExternal: exampleExternalErpDelivery.validateExternal,
        maxAttempts: 3,
        failureNotificationType: 'example.todo.erp.failed',
      }),
      fields: {
        erpSupplierRef: field.add({ type: 'text', labelKey: 'example.todoShowcase.fields.supplier' }),
        erpCostCenter: field.add({ type: 'text', labelKey: 'example.todoShowcase.fields.costCenter' }),
      },
    }),
  },
  defaults: {
    title: {
      targets: [{ formVariant: 'showcase', formOperation: 'create' }],
      resolve: () => 'Todo',
    },
  },
})] as const
