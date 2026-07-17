export type EventBusLike = {
  emitEvent?: (event: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => Promise<void> | void
}
