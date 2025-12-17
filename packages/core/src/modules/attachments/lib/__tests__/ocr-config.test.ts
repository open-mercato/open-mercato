describe('attachments OCR config default', () => {
  const ENV_KEY = 'OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED'

  afterEach(() => {
    delete process.env[ENV_KEY]
    jest.resetModules()
  })

  it('defaults to true when env is missing', async () => {
    const { resolveDefaultAttachmentOcrEnabled } = await import('../ocrConfig')
    expect(resolveDefaultAttachmentOcrEnabled()).toBe(true)
  })

  it('reads boolean true when env set to "true"', async () => {
    process.env[ENV_KEY] = 'true'
    jest.resetModules()
    const { resolveDefaultAttachmentOcrEnabled } = await import('../ocrConfig')
    expect(resolveDefaultAttachmentOcrEnabled()).toBe(true)
  })

  it('reads boolean false when env set to "false"', async () => {
    process.env[ENV_KEY] = 'false'
    jest.resetModules()
    const { resolveDefaultAttachmentOcrEnabled } = await import('../ocrConfig')
    expect(resolveDefaultAttachmentOcrEnabled()).toBe(false)
  })
})
