import { AsyncLocalStorage } from 'node:async_hooks'
import type { AiModelFactoryInput, AiModelResolution } from './model-factory'

export type ModelFactoryOverride = (
  input: AiModelFactoryInput,
  resolveLive: () => AiModelResolution,
) => AiModelResolution

type ModelFactoryScope = { override?: ModelFactoryOverride; isolateTools?: boolean }

const storageKey = Symbol.for('@open-mercato/ai-assistant/model-factory-context')
const scope = globalThis as typeof globalThis & {
  [storageKey]?: AsyncLocalStorage<ModelFactoryScope>
}
const storage = scope[storageKey] ??= new AsyncLocalStorage<ModelFactoryScope>()

export function withModelFactoryOverride<T>(override: ModelFactoryOverride, run: () => Promise<T>, options: { isolateTools?: boolean } = {}): Promise<T> {
  return storage.run({ override, ...options }, run)
}

export function getModelFactoryOverride(): ModelFactoryOverride | undefined {
  return storage.getStore()?.override
}

export function shouldIsolateModelFactoryTools(): boolean {
  return storage.getStore()?.isolateTools === true
}

export function withModelFactoryToolScope<T>(run: () => Promise<T>): Promise<T> {
  return shouldIsolateModelFactoryTools() ? storage.run({}, run) : run()
}
