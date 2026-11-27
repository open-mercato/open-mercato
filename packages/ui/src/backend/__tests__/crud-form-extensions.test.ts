/** @jest-environment node */

import { z } from 'zod'
import {
  add, defineCrudFormExtension, field, hide, modify, replace, store,
  type CrudFormExtensionDefinition, type CrudFormExtensionServerFieldContext,
} from '../crud-form-extensions'

describe('CrudForm extension declarations', () => {
  it('keeps the spec’s section and field operations distinct and preserves the declaration', () => {
    const loadReplacement = jest.fn(async () => ({
      crudFormSectionRuntime: { id: 'example.meta', roundTripId: 'example.meta@v1' },
    }))
    const definition = {
      id: 'my_app.product_form',
      host: 'crud-form:catalog.product',
      targets: [{ formVariant: 'edit', formOperation: 'update' }],
      sections: {
        compliance: hide(),
        details: modify({
          fields: {
            title: field.patch({ labelKey: 'my_app.fields.product_name' }),
            description: field.remove(),
            brand: field.add({
              type: 'text', labelKey: 'my_app.fields.brand', after: 'title', required: true,
              store: store.table('my_app:product_brand'),
            }),
          },
        }),
        meta: replace(loadReplacement),
      },
    } as const satisfies CrudFormExtensionDefinition
    expect(defineCrudFormExtension(definition)).toBe(definition)
    expect(definition.sections).toEqual({
      compliance: { operation: 'hide' },
      details: { operation: 'modify', options: { fields: {
        title: { operation: 'patch', patch: { labelKey: 'my_app.fields.product_name' } },
        description: { operation: 'remove' },
        brand: {
          operation: 'add',
          definition: {
            type: 'text', labelKey: 'my_app.fields.brand', after: 'title', required: true,
            store: { kind: 'table', entityId: 'my_app:product_brand' },
          },
        },
      } } },
      meta: { operation: 'replace', load: loadReplacement },
    })
    expect(loadReplacement).not.toHaveBeenCalled()
  })

  it('leaves field storage absent for an inherited section store or the default custom field', () => {
    const deliver = jest.fn(async () => ({ status: 'applied' as const }))
    const validateExternal = jest.fn(async () => undefined)
    const external = store.external({
      integrationId: 'erp_acme', mirror: 'my_app:erp_product_link', deliver, validateExternal,
    })
    const section = add({
      after: 'meta', titleKey: 'my_app.erp.title',
      fields: {
        supplierRef: field.add({ type: 'text', required: true }),
        costCenter: field.add({ type: 'text' }),
        note: field.add({ type: 'textarea', store: store.customField('erp_note') }),
      },
      store: external,
    })
    expect(section.options.store).toBe(external)
    expect(section.options.fields.supplierRef.definition).not.toHaveProperty('store')
    expect(section.options.fields.costCenter.definition).not.toHaveProperty('store')
    expect(section.options.fields.note.definition.store).toEqual({ kind: 'customField', key: 'erp_note' })
    expect(store.customField()).toEqual({ kind: 'customField' })
    expect(external.config.deliver).toBe(deliver)
    expect(external.config.validateExternal).toBe(validateExternal)
    expect(deliver).not.toHaveBeenCalled()
    expect(validateExternal).not.toHaveBeenCalled()
  })

  it('retains browser, default, validation, and sink callbacks without evaluating them', () => {
    const choices = [{ value: 'north', labelKey: 'my_app.region.north' }] as const
    const loadOptions = jest.fn(async () => ({ default: choices }))
    const loadValidation = jest.fn(async () => ({ default: () => true as const }))
    const validateServer = jest.fn((value: unknown, { scope }: CrudFormExtensionServerFieldContext) =>
      scope.tenantId && value !== '' ? true as const : 'my_app.errors.required')
    const persist = jest.fn(async () => ({ before: null, after: null }))
    const load = jest.fn(async () => null)
    const sink = store.sink({
      entityId: 'my_app:rating', atomicity: 'host-transaction', schema: z.object({ rating: z.number() }),
      persist, load,
    })
    const defaults = { handle: jest.fn(() => 'draft') }
    const extension = defineCrudFormExtension({
      id: 'my_app.product_fields',
      host: 'crud-form:catalog.product',
      targets: [{ formVariant: 'create', formOperation: 'create' }],
      sections: {
        fields: add({
          fields: {
            rating: field.add({ type: 'number', store: sink }),
            area: field.add({ type: 'select', options: choices }),
            region: field.add({ type: 'select', options: loadOptions, validate: { client: loadValidation } }),
          },
        }),
        details: modify({
          fields: {
            sku: field.patch({
              validate: {
                pattern: '^[A-Z0-9-]+$', messageKey: 'my_app.errors.sku', enforce: 'client-and-server',
                server: validateServer,
              },
            }),
          },
        }),
      },
      defaults,
    })
    expect(extension.defaults).toBe(defaults)
    expect(extension.sections.fields.options.fields.area.definition.options).toBe(choices)
    expect(extension.sections.fields.options.fields.region.definition.options).toBe(loadOptions)
    expect(extension.sections.fields.options.fields.region.definition.validate.client).toBe(loadValidation)
    expect(extension.sections.details.options.fields.sku.patch.validate.server).toBe(validateServer)
    expect(sink.config.persist).toBe(persist)
    expect(sink.config.load).toBe(load)
    for (const callback of [defaults.handle, loadOptions, loadValidation, validateServer, persist, load]) {
      expect(callback).not.toHaveBeenCalled()
    }
  })
})
