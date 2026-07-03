jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import {
  buildDefinitionsBatchPayload,
  buildEntityMetadataPayload,
  buildEntitySettingsFields,
  getEntitySettingsNotice,
  shouldRegisterEntityMetadata,
} from '../[entityId]/page'

describe('shouldRegisterEntityMetadata', () => {
  it('registers metadata for custom (user-defined) entities', () => {
    expect(shouldRegisterEntityMetadata('custom')).toBe(true)
  })

  it('does not register metadata for code-declared system entities (#3115)', () => {
    expect(shouldRegisterEntityMetadata('code')).toBe(false)
  })
})

describe('getEntitySettingsNotice', () => {
  const fallbackTranslate = (_key: string, fallback?: unknown) =>
    typeof fallback === 'string' ? fallback : _key

  it('routes the system-entity notice through i18n with a code-declared key (#3151)', () => {
    const keys: string[] = []
    const recordingTranslate = (key: string, fallback?: unknown) => {
      keys.push(key)
      return typeof fallback === 'string' ? fallback : key
    }
    const notice = getEntitySettingsNotice('code', recordingTranslate as never)
    expect(keys).toContain('entities.userEntities.form.systemEntityNotice')
    expect(typeof notice).toBe('string')
    expect(notice).toMatch(/cannot be edited/i)
  })

  it('returns no notice for custom entities', () => {
    expect(getEntitySettingsNotice('custom', fallbackTranslate as never)).toBeUndefined()
  })
})

describe('buildEntitySettingsFields', () => {
  const byId = (fields: ReturnType<typeof buildEntitySettingsFields>) =>
    Object.fromEntries(fields.map((field) => [field.id, field]))

  it('disables Label, Description, and Default Editor for code-declared system entities (#3151)', () => {
    // Regression guard for the QA failure: `readOnly` is a silent no-op for
    // text/textarea/select in CrudForm, so the metadata fields must be `disabled`
    // to actually reject keyboard input and read as non-editable.
    const fields = byId(buildEntitySettingsFields('code'))
    expect(fields.label.disabled).toBe(true)
    expect(fields.description.disabled).toBe(true)
    expect(fields.defaultEditor.disabled).toBe(true)
  })

  it('does not expose the sidebar toggle for system entities', () => {
    const fields = byId(buildEntitySettingsFields('code'))
    expect(fields.showInSidebar).toBeUndefined()
  })

  it('keeps metadata fields editable for custom entities and exposes the sidebar toggle', () => {
    const fields = byId(buildEntitySettingsFields('custom'))
    expect(fields.label.disabled).toBeFalsy()
    expect(fields.description.disabled).toBeFalsy()
    expect(fields.defaultEditor.disabled).toBeFalsy()
    expect(fields.showInSidebar).toBeDefined()
    expect(fields.showInSidebar.disabled).toBeFalsy()
  })
})

describe('buildEntityMetadataPayload', () => {
  describe('code-sourced (system) entities', () => {
    it('returns a payload with label, description, and defaultEditor', () => {
      const result = buildEntityMetadataPayload('code', {
        label: 'My Entity',
        description: 'Some description',
        defaultEditor: 'markdown',
      })
      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        label: 'My Entity',
        description: 'Some description',
        defaultEditor: 'markdown',
      })
    })

    it('returns a payload even when only label is provided', () => {
      const result = buildEntityMetadataPayload('code', { label: 'System Entity' })
      expect(result).not.toBeNull()
      expect(result?.label).toBe('System Entity')
    })

    it('does not include showInSidebar in the payload', () => {
      const result = buildEntityMetadataPayload('code', {
        label: 'My Entity',
        showInSidebar: true,
      })
      expect(result).not.toBeNull()
      expect(result).not.toHaveProperty('showInSidebar')
    })

    it('normalizes empty string defaultEditor to undefined', () => {
      const result = buildEntityMetadataPayload('code', {
        label: 'My Entity',
        defaultEditor: '',
      })
      expect(result).not.toBeNull()
      expect(result?.defaultEditor).toBeUndefined()
    })
  })

  describe('custom entities', () => {
    it('returns a payload with showInSidebar', () => {
      const result = buildEntityMetadataPayload('custom', {
        label: 'Custom Entity',
        description: 'Custom description',
        showInSidebar: true,
      })
      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        label: 'Custom Entity',
        description: 'Custom description',
        showInSidebar: true,
      })
    })

    it('returns a valid payload when showInSidebar is not provided', () => {
      const result = buildEntityMetadataPayload('custom', { label: 'Custom Entity' })
      expect(result).not.toBeNull()
      expect(result?.label).toBe('Custom Entity')
    })
  })

  it('returns null when label is missing', () => {
    const result = buildEntityMetadataPayload('code', { description: 'No label here' })
    expect(result).toBeNull()
  })

  it('returns null when label is empty', () => {
    const result = buildEntityMetadataPayload('custom', { label: '' })
    expect(result).toBeNull()
  })
})

describe('buildDefinitionsBatchPayload', () => {
  it('preserves inactive definitions so inherited fields can be hidden', () => {
    const result = buildDefinitionsBatchPayload({
      entityId: 'customers:customer_deal',
      defs: [
        {
          key: 'hide_me',
          kind: 'text',
          configJson: { label: 'Hide me' },
          isActive: false,
        },
        {
          key: 'keep_me',
          kind: 'text',
          configJson: { label: 'Keep me' },
          isActive: true,
        },
      ],
      fieldsets: [{ code: 'main', label: 'Main' }],
      singleFieldsetPerRecord: true,
    })

    expect(result).toEqual({
      entityId: 'customers:customer_deal',
      definitions: [
        {
          key: 'hide_me',
          kind: 'text',
          configJson: { label: 'Hide me' },
          isActive: false,
        },
        {
          key: 'keep_me',
          kind: 'text',
          configJson: { label: 'Keep me' },
          isActive: true,
        },
      ],
      fieldsets: [{ code: 'main', label: 'Main' }],
      singleFieldsetPerRecord: true,
    })
  })

  it('omits incomplete definitions without keys', () => {
    const result = buildDefinitionsBatchPayload({
      entityId: 'customers:customer_deal',
      defs: [
        {
          key: '',
          kind: 'text',
          configJson: {},
          isActive: true,
        },
      ],
      fieldsets: [],
      singleFieldsetPerRecord: false,
    })

    expect(result.definitions).toEqual([])
    expect(result.singleFieldsetPerRecord).toBe(false)
  })
})
