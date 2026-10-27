import type { InjectionBulkActionWidget } from '@open-mercato/shared/modules/widgets/injection'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

/**
 * Todo DataTable bulk action → durable operation → top progress bar.
 *
 * This is a data-only `widget.ts`, not a `widget.client.tsx`, because
 * `InjectionBulkActionDefinition` has no React component slot: the DataTable
 * calls `onExecute(selectedRows, context)` directly and the bulk-action context it
 * passes carries no `runMutation`. The `readApiResultOrThrow` + returned
 * `progressJobId` shape IS the contract — `DataTable.runBulkAction` tracks the id,
 * clears the selection, flashes the start message, and refreshes on the terminal
 * `progress.job.*` event.
 *
 * The host table needs no change: `DataTable` derives `extensionTableId` from
 * `perspective.tableId`, which `TodosTable` already sets to `example.todos.list`.
 */

type BulkCompleteResponse = {
  ok?: boolean
  progressJobId?: string | null
  message?: string
}

function readRowId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null
  const value = (row as Record<string, unknown>).id
  if (typeof value !== 'string' || value.length === 0) return null
  return value
}

/**
 * One key per invocation, so a double-click sends the same key twice and the
 * route returns the first operation's `progressJobId` instead of starting a
 * second one.
 */
function createIdempotencyKey(): string {
  const cryptoRef = globalThis.crypto
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID()
  const random = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${random()}${random()}-${random()}-4${random().slice(1)}-a${random().slice(1)}-${random()}${random()}${random()}`
}

const widget: InjectionBulkActionWidget = {
  metadata: {
    id: 'example.injection.todo-bulk-complete',
    priority: 20,
  },
  bulkActions: [
    {
      id: 'example.todos.mark-done',
      label: 'example.todos.bulk.markDone',
      onExecute: async (selectedRows) => {
        const ids = selectedRows
          .map((row) => readRowId(row))
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
        if (!ids.length) {
          return { ok: false, message: undefined }
        }

        const result = await readApiResultOrThrow<BulkCompleteResponse>(
          '/api/example/todos/bulk-complete',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids, idempotencyKey: createIdempotencyKey() }),
          },
        )

        return {
          ok: result.ok !== false,
          progressJobId: result.progressJobId ?? null,
          message: result.message,
        }
      },
    },
  ],
}

export default widget
