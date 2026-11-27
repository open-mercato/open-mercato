import { getCrudFormSectionClientRegistryState } from '@open-mercato/shared/lib/crud/form-sections/client-registry'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import type { TodoListItem } from '../types'

export const todoShowcaseHostId = 'example.todo'
export const todoShowcaseMutationEndpoint = '/api/example/todos/section-policy'
export const todoShowcaseHref = '/backend/example/form-extensions/todos'

export function showcaseSinks() {
  const snapshot = getCrudFormSectionClientRegistryState()
  return snapshot.state === 'ready' ? (snapshot.registry.versionedSinks ?? []).filter((sink) =>
    sink.hostId === todoShowcaseHostId && sink.formVariant === 'showcase'
    && sink.formOperation === 'update' && sink.ownerModuleId === 'example') : []
}

type TodoShowcaseItem = TodoListItem & { _extensions?: { example?: Record<string, unknown> } }

export async function readTodoShowcase(id: string): Promise<TodoShowcaseItem | null> {
  const records = await fetchCrudList<TodoShowcaseItem>('example/todos', { id, pageSize: 1, sectionDetail: 'showcase' })
  return records?.items?.[0] ?? null
}
