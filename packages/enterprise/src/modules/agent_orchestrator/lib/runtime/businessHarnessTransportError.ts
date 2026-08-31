export class BusinessHarnessClientError extends Error {
  readonly code: string
  readonly status?: number

  constructor(code: string, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BusinessHarnessClientError'
    this.code = code
    this.status = options.status
  }
}
