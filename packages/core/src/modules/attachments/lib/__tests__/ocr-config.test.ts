describe('attachments OCR config default', () => {
  const PRIMARY_ENV_KEY = 'OM_DEFAULT_ATTACHMENT_OCR_ENABLED'
  const LEGACY_ENV_KEY = 'OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED'

  afterEach(() => {
    delete process.env[PRIMARY_ENV_KEY]
    delete process.env[LEGACY_ENV_KEY]
    jest.resetModules()
  })

  it('defaults to true when env is missing', async () => {
    const { resolveDefaultAttachmentOcrEnabled } = await import('../ocrConfig')
    expect(resolveDefaultAttachmentOcrEnabled()).toBe(true)
  })

  it('reads boolean true when env set to "true"', async () => {
    process.env[PRIMARY_ENV_KEY] = 'true'
    jest.resetModules()
    const { resolveDefaultAttachmentOcrEnabled } = await import('../ocrConfig')
    expect(resolveDefaultAttachmentOcrEnabled()).toBe(true)
  })

  it('reads boolean false when env set to "false"', async () => {
    process.env[PRIMARY_ENV_KEY] = 'false'
    jest.resetModules()
    const { resolveDefaultAttachmentOcrEnabled } = await import('../ocrConfig')
    expect(resolveDefaultAttachmentOcrEnabled()).toBe(false)
  })

  it('falls back to the legacy env alias when the OM env is unset', async () => {
    process.env[LEGACY_ENV_KEY] = 'false'
    jest.resetModules()
    const { resolveDefaultAttachmentOcrEnabled } = await import('../ocrConfig')
    expect(resolveDefaultAttachmentOcrEnabled()).toBe(false)
  })
})
