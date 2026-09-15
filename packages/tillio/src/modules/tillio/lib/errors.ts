export class TillioApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(message: string, status: number, detail: string) {
    super(message)
    this.name = 'TillioApiError'
    this.status = status
    this.detail = detail
  }
}
