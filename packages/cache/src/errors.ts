export class CacheDependencyUnavailableError extends Error {
  public readonly strategy: string
  public readonly dependency: string
  public readonly originalError?: unknown

  constructor(strategy: string, dependency: string, originalError?: unknown) {
    super(`Cache strategy "${strategy}" requires dependency "${dependency}" which is not available`)
    this.name = 'CacheDependencyUnavailableError'
    this.strategy = strategy
    this.dependency = dependency
    this.originalError = originalError
  }
}

