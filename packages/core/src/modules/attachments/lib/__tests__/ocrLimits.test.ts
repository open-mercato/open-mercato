/** @jest-environment node */

describe('ocrLimits', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    jest.resetModules()
  })

  it('defaults page/timeout/token/concurrency bounds', async () => {
    delete process.env.OM_ATTACHMENT_OCR_MAX_PAGES
    delete process.env.OM_ATTACHMENT_OCR_PAGE_TIMEOUT_MS
    delete process.env.OM_ATTACHMENT_OCR_MAX_OUTPUT_TOKENS
    delete process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY
    delete process.env.OM_ATTACHMENT_OCR_MAX_WAIT_QUEUE

    const {
      resolveMaxOcrPages,
      resolveOcrPageTimeoutMs,
      resolveOcrMaxOutputTokens,
      resolveOcrMaxConcurrency,
      resolveOcrMaxWaitQueue,
      resolvePdfPageIterationLimit,
    } = await import('../ocrLimits')

    expect(resolveMaxOcrPages()).toBe(50)
    expect(resolveOcrPageTimeoutMs()).toBe(60_000)
    expect(resolveOcrMaxOutputTokens()).toBe(4_096)
    expect(resolveOcrMaxConcurrency()).toBe(2)
    expect(resolveOcrMaxWaitQueue()).toBe(50)
    expect(resolvePdfPageIterationLimit(10_000)).toBe(50)
    expect(resolvePdfPageIterationLimit(12, 50)).toBe(12)
  })

  it('honors env overrides and ignores invalid values', async () => {
    process.env.OM_ATTACHMENT_OCR_MAX_PAGES = '7'
    process.env.OM_ATTACHMENT_OCR_PAGE_TIMEOUT_MS = '1500'
    process.env.OM_ATTACHMENT_OCR_MAX_OUTPUT_TOKENS = '512'
    process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY = '1'
    process.env.OM_ATTACHMENT_OCR_MAX_WAIT_QUEUE = '12'

    const {
      resolveMaxOcrPages,
      resolveOcrPageTimeoutMs,
      resolveOcrMaxOutputTokens,
      resolveOcrMaxConcurrency,
      resolveOcrMaxWaitQueue,
      resolvePdfPageIterationLimit,
    } = await import('../ocrLimits')

    expect(resolveMaxOcrPages()).toBe(7)
    expect(resolveOcrPageTimeoutMs()).toBe(1500)
    expect(resolveOcrMaxOutputTokens()).toBe(512)
    expect(resolveOcrMaxConcurrency()).toBe(1)
    expect(resolveOcrMaxWaitQueue()).toBe(12)
    expect(resolvePdfPageIterationLimit(100, resolveMaxOcrPages())).toBe(7)

    process.env.OM_ATTACHMENT_OCR_MAX_PAGES = '0'
    jest.resetModules()
    const again = await import('../ocrLimits')
    expect(again.resolveMaxOcrPages()).toBe(50)
  })

  it('defaults spreadsheet extraction bounds and honors env overrides', async () => {
    delete process.env.OM_ATTACHMENT_SPREADSHEET_MAX_UNCOMPRESSED_BYTES
    delete process.env.OM_ATTACHMENT_SPREADSHEET_MAX_SHEETS
    delete process.env.OM_ATTACHMENT_SPREADSHEET_MAX_CELLS
    delete process.env.OM_ATTACHMENT_SPREADSHEET_MAX_TEXT_CHARS
    delete process.env.OM_ATTACHMENT_SPREADSHEET_MAX_CONCURRENCY
    delete process.env.OM_ATTACHMENT_SPREADSHEET_MAX_WAIT_QUEUE

    const defaults = await import('../ocrLimits')
    expect(defaults.resolveSpreadsheetMaxUncompressedBytes()).toBe(5 * 1024 * 1024)
    expect(defaults.resolveSpreadsheetMaxSheets()).toBe(10)
    expect(defaults.resolveSpreadsheetMaxCells()).toBe(1_000_000)
    expect(defaults.resolveSpreadsheetMaxTextChars()).toBe(1_000_000)
    expect(defaults.resolveSpreadsheetMaxConcurrency()).toBe(2)
    expect(defaults.resolveSpreadsheetMaxWaitQueue()).toBe(20)

    process.env.OM_ATTACHMENT_SPREADSHEET_MAX_UNCOMPRESSED_BYTES = '1024'
    process.env.OM_ATTACHMENT_SPREADSHEET_MAX_SHEETS = '3'
    process.env.OM_ATTACHMENT_SPREADSHEET_MAX_CELLS = '10'
    process.env.OM_ATTACHMENT_SPREADSHEET_MAX_TEXT_CHARS = 'not-a-number'
    process.env.OM_ATTACHMENT_SPREADSHEET_MAX_CONCURRENCY = '1'
    process.env.OM_ATTACHMENT_SPREADSHEET_MAX_WAIT_QUEUE = '-3'
    expect(defaults.resolveSpreadsheetMaxUncompressedBytes()).toBe(1024)
    expect(defaults.resolveSpreadsheetMaxSheets()).toBe(3)
    expect(defaults.resolveSpreadsheetMaxCells()).toBe(10)
    expect(defaults.resolveSpreadsheetMaxTextChars()).toBe(1_000_000)
    expect(defaults.resolveSpreadsheetMaxConcurrency()).toBe(1)
    expect(defaults.resolveSpreadsheetMaxWaitQueue()).toBe(20)
  })

  it('exposes attachments upload rate-limit defaults', async () => {
    delete process.env.RATE_LIMIT_ATTACHMENTS_UPLOAD_POINTS
    delete process.env.RATE_LIMIT_ATTACHMENTS_UPLOAD_DURATION

    const { resolveAttachmentsUploadRateLimitConfig } = await import('../ocrLimits')
    expect(resolveAttachmentsUploadRateLimitConfig()).toEqual({
      points: 100,
      duration: 60,
      blockDuration: undefined,
      keyPrefix: 'attachments_upload',
    })
  })
})
