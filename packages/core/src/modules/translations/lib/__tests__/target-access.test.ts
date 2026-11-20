import type { EntityMetadata } from '@mikro-orm/core'
import '@open-mercato/core/modules/entities/translations'
import { classifyRecordsEntity } from '@open-mercato/core/modules/entities/lib/entityClassification'
import type { TranslationsRouteContext } from '@open-mercato/core/modules/translations/api/context'
import { registerTranslatableFieldExpander, registerTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'
import { getRegisteredTextFields, resolveTranslationOwnerMetadata } from '../registered-fields'
import { resolveTranslationTargetFields } from '../target-access'

jest.mock('@open-mercato/core/modules/entities/lib/entityClassification', () => ({
  classifyRecordsEntity: jest.fn(),
}))
jest.mock('../registered-fields', () => ({
  ...jest.requireActual('../registered-fields'),
  resolveTranslationOwnerMetadata: jest.fn(),
}))

const organizationId = '671dd322-bb76-4a07-a959-ed6f2c98400c'
const tenantId = '7142c115-12a0-4588-be2a-3dc647a7304d'
const subject = 'ef38847d-293a-4242-a5e1-40f0f93db4af'
const entityId = 'fa01fad9-ed47-4393-a74b-cb304c60dfc6'
const productType = 'catalog:catalog_product'
const optionTemplateType = 'catalog:catalog_option_schema_template'
const customFieldType = 'entities:custom_field_def'
const metadata = {
  primaryKeys: ['id'],
  properties: { id: { type: 'uuid', fieldNames: ['id'] }, deletedAt: { fieldNames: ['deleted_at'] } },
  props: [
    { name: 'id', primary: true, columnTypes: ['uuid'], fieldNames: ['id'] },
    { name: 'title', columnTypes: ['text'], fieldNames: ['title'] },
    { name: 'unitCost', runtimeType: 'string', columnTypes: ['numeric(18,2)'], fieldNames: ['unit_cost'] },
  ],
} as unknown as EntityMetadata

const db = {
  selectFrom: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  selectAll: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  executeTakeFirst: jest.fn(),
  execute: jest.fn(),
}
const rbac = { userHasAllFeatures: jest.fn(), loadAcl: jest.fn() }
const context = {
  auth: { sub: subject, tenantId: 'token-tenant', orgId: 'token-organization' },
  tenantId,
  organizationId,
  db,
  container: { resolve: jest.fn(() => rbac) },
  em: {},
} as unknown as TranslationsRouteContext

describe('translation target authorization and fields', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    registerTranslatableFields({
      [productType]: ['title', 'id', 'unitCost', 'unit_cost'],
      [optionTemplateType]: ['name'],
      [customFieldType]: ['label', 'description'],
    })
    jest.mocked(classifyRecordsEntity).mockResolvedValue({ kind: 'system', restricted: false })
    jest.mocked(resolveTranslationOwnerMetadata).mockReturnValue({
      metadata,
      source: { table: 'catalog_products', organizationColumn: 'organization_id', tenantColumn: 'tenant_id' },
    })
    rbac.userHasAllFeatures.mockResolvedValue(true)
    db.executeTakeFirst.mockResolvedValue({ id: entityId })
  })

  it('rejects an unregistered entity before looking it up', async () => {
    await expect(resolveTranslationTargetFields(context, 'catalog:unregistered', entityId, 'manage'))
      .rejects.toMatchObject({ status: 400 })
    expect(classifyRecordsEntity).not.toHaveBeenCalled()
    expect(db.selectFrom).not.toHaveBeenCalled()
  })

  it('authorizes against the effective scope and checks a live owner by its primary key', async () => {
    await expect(resolveTranslationTargetFields(context, productType, entityId, 'manage'))
      .resolves.toEqual(new Set(['title']))
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(subject, ['catalog.products.manage'], { tenantId, organizationId })
    expect(db.selectFrom).toHaveBeenCalledWith('catalog_products')
    expect(db.where).toHaveBeenCalledWith('id', '=', entityId)
    expect(db.where).toHaveBeenCalledWith('tenant_id', '=', tenantId)
    expect(db.where).toHaveBeenCalledWith('deleted_at', 'is', null)
  })

  it('rejects the operation before a record lookup when its target feature is missing', async () => {
    rbac.userHasAllFeatures.mockResolvedValue(false)
    await expect(resolveTranslationTargetFields(context, productType, entityId, 'view'))
      .rejects.toMatchObject({ status: 403 })
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(subject, ['catalog.products.view'], { tenantId, organizationId })
    expect(db.selectFrom).not.toHaveBeenCalled()
  })

  it('requires coarse entity-record access for a registered custom entity', async () => {
    jest.mocked(classifyRecordsEntity).mockResolvedValue({ kind: 'custom', restricted: false })
    rbac.userHasAllFeatures.mockResolvedValue(false)
    await expect(resolveTranslationTargetFields(context, productType, entityId, 'manage'))
      .rejects.toMatchObject({ status: 403 })
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(subject, ['entities.records.manage'], { tenantId, organizationId })
    expect(db.selectFrom).not.toHaveBeenCalled()
  })

  it('rejects an absent owner with 404', async () => {
    db.executeTakeFirst.mockResolvedValue(undefined)
    await expect(resolveTranslationTargetFields(context, productType, entityId, 'view'))
      .rejects.toMatchObject({ status: 404 })
  })

  it('preserves field expanders constrained to the current record', async () => {
    registerTranslatableFieldExpander(optionTemplateType, (record) =>
      record.schema ? [{ key: 'options.size.label' }] : [],
    )
    db.executeTakeFirst.mockResolvedValue({ id: entityId, schema: {} })
    await expect(resolveTranslationTargetFields(context, optionTemplateType, entityId, 'manage'))
      .resolves.toEqual(new Set(['name', 'options.size.label']))
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(subject, ['catalog.settings.manage'], { tenantId, organizationId })
  })

  it('honors tombstones for scoped composite field definitions', async () => {
    db.execute.mockResolvedValue([{
      is_active: true,
      deleted_at: null,
      config_json: { options: [{ value: 'winter', label: 'Winter' }] },
    }])
    await expect(resolveTranslationTargetFields(context, customFieldType, 'catalog:catalog_product:season', 'view'))
      .resolves.toEqual(new Set(['label', 'description', 'options.winter.label']))
    expect(db.where).toHaveBeenCalledWith('entity_id', '=', 'catalog:catalog_product')
    expect(db.where).toHaveBeenCalledWith('key', '=', 'season')

    db.execute.mockResolvedValue([
      { is_active: true, deleted_at: null },
      { is_active: false, deleted_at: '2026-11-19T00:00:00Z' },
    ])
    await expect(resolveTranslationTargetFields(context, customFieldType, 'catalog:catalog_product:season', 'view'))
      .rejects.toMatchObject({ status: 404 })
  })

  it('removes monetary columns serialized as strings from the text field allowlist', () => {
    expect(getRegisteredTextFields(productType, metadata)).toEqual(new Set(['title']))
  })
})
