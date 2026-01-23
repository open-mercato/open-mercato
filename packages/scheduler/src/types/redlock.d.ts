declare module 'redlock' {
  import type { Redis } from 'ioredis'

  export interface RedlockOptions {
    driftFactor?: number
    retryCount?: number
    retryDelay?: number
    retryJitter?: number
    automaticExtensionThreshold?: number
  }

  export interface Lock {
    resource: string
    value: string
    expiration: number
    unlock(): Promise<void>
    extend(ttl: number): Promise<Lock>
  }

  export default class Redlock {
    constructor(clients: Redis[], options?: RedlockOptions)
    acquire(resources: string[], ttl: number): Promise<Lock>
    release(lock: Lock): Promise<void>
    on(event: 'clientError' | 'error', handler: (error: Error) => void): void
  }
}
