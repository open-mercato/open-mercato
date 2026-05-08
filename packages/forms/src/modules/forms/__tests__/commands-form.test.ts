import {
  formArchiveCommandSchema,
  formCreateCommandSchema,
  formRenameCommandSchema,
  formRestoreCommandSchema,
  formVersionForkDraftCommandSchema,
  formVersionPublishCommandSchema,
  formVersionUpdateDraftCommandSchema,
} from '../data/validators'

describe('forms command schemas', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'
  const formId = '33333333-3333-4333-8333-333333333333'
  const versionId = '44444444-4444-4444-8444-444444444444'

  it('forms.form.create requires key/name/locale', () => {
    expect(() => formCreateCommandSchema.parse({
      tenantId,
      organizationId,
      key: 'patient-intake',
      name: 'Patient intake',
      defaultLocale: 'en',
      supportedLocales: ['en'],
    })).not.toThrow()
    expect(() => formCreateCommandSchema.parse({
      tenantId,
      organizationId,
      key: 'INVALID KEY',
      name: 'x',
      defaultLocale: 'en',
      supportedLocales: ['en'],
    })).toThrow()
    expect(() => formCreateCommandSchema.parse({
      tenantId,
      organizationId,
      key: 'good',
      name: '',
      defaultLocale: 'en',
      supportedLocales: ['en'],
    })).toThrow()
  })

  it('forms.form.rename allows partial updates', () => {
    expect(() => formRenameCommandSchema.parse({
      tenantId,
      organizationId,
      id: formId,
      name: 'New name',
    })).not.toThrow()
    expect(() => formRenameCommandSchema.parse({
      tenantId,
      organizationId,
      id: formId,
    })).not.toThrow()
  })

  it('forms.form.archive and restore require id', () => {
    expect(() => formArchiveCommandSchema.parse({ tenantId, organizationId, id: formId })).not.toThrow()
    expect(() => formRestoreCommandSchema.parse({ tenantId, organizationId, id: formId })).not.toThrow()
    expect(() => formArchiveCommandSchema.parse({ tenantId, organizationId, id: 'not-uuid' })).toThrow()
  })

  it('forms.form_version.fork_draft accepts optional fromVersionId', () => {
    expect(() => formVersionForkDraftCommandSchema.parse({
      tenantId,
      organizationId,
      formId,
    })).not.toThrow()
    expect(() => formVersionForkDraftCommandSchema.parse({
      tenantId,
      organizationId,
      formId,
      fromVersionId: versionId,
    })).not.toThrow()
  })

  it('forms.form_version.update_draft permits schema/uiSchema/roles updates', () => {
    expect(() => formVersionUpdateDraftCommandSchema.parse({
      tenantId,
      organizationId,
      formId,
      versionId,
      schema: { type: 'object', properties: {} },
      uiSchema: {},
      roles: ['admin', 'patient'],
      changelog: 'edits',
    })).not.toThrow()
  })

  it('forms.form_version.publish allows optional changelog', () => {
    expect(() => formVersionPublishCommandSchema.parse({
      tenantId,
      organizationId,
      formId,
      versionId,
    })).not.toThrow()
    expect(() => formVersionPublishCommandSchema.parse({
      tenantId,
      organizationId,
      formId,
      versionId,
      changelog: 'Initial release',
    })).not.toThrow()
  })

  it('rejects role identifiers with invalid shape', () => {
    expect(() => formVersionUpdateDraftCommandSchema.parse({
      tenantId,
      organizationId,
      formId,
      versionId,
      roles: ['Patient'],
    })).toThrow()
  })
})
