declare module 'apache-ignite-client' {
  type ConnectionOptions = Record<string, unknown>

  class IgniteClientConfiguration {
    constructor(...endpoints: string[])
    setUserName(userName: string | null): IgniteClientConfiguration
    setPassword(password: string | null): IgniteClientConfiguration
    setConnectionOptions(useTLS: boolean, connectionOptions?: ConnectionOptions | null): IgniteClientConfiguration
  }

  class CacheEntry {
    getKey(): unknown
    getValue(): unknown
  }

  class Cursor {
    getValue(): Promise<CacheEntry | null>
    hasMore(): boolean
    close(): Promise<void>
  }

  class ScanQuery {
    constructor()
    setPageSize(pageSize: number): ScanQuery
  }

  class CacheClient {
    setKeyType(type: number): CacheClient
    setValueType(type: number): CacheClient
    get(key: string): Promise<unknown>
    put(key: string, value: string): Promise<void>
    containsKey(key: string): Promise<boolean>
    removeKey(key: string): Promise<boolean>
    removeIfEquals(key: string, value: string): Promise<boolean>
    replaceIfEquals(key: string, value: string, newValue: string): Promise<boolean>
    getSize(...peekModes: number[]): Promise<number>
    query(query: ScanQuery): Promise<Cursor>
  }

  class CacheConfiguration {}

  type StateListener = (state: number, reason: string | null) => void

  class IgniteClient {
    constructor(onStateChanged?: StateListener | null)
    static readonly STATE: { DISCONNECTED: number; CONNECTING: number; CONNECTED: number }
    static readonly ObjectType: { PRIMITIVE_TYPE: { STRING: number } }
    static readonly IgniteClientConfiguration: typeof IgniteClientConfiguration
    static readonly ScanQuery: typeof ScanQuery
    static readonly CacheConfiguration: typeof CacheConfiguration
    connect(config: IgniteClientConfiguration): Promise<void>
    disconnect(): void
    getOrCreateCache(name: string, cacheConfig?: CacheConfiguration | null): Promise<CacheClient>
    getCache(name: string): CacheClient
    cacheNames(): Promise<string[]>
    destroyCache(name: string): Promise<void>
  }

  export default IgniteClient
  export type { CacheClient, Cursor, CacheEntry, IgniteClientConfiguration, ScanQuery, StateListener }
}
