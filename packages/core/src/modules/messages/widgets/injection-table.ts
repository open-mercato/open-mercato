import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Messages module — widget injection table.
 *
 * The messages module currently does not register any widgets INTO other modules' spots.
 * This file exists primarily to document the spots the messages module EXPOSES for other
 * modules to inject into. The actual `<InjectionSpot>` placements live in the messages
 * pages themselves (see `components/MessagesInboxPageClient.tsx`,
 * `components/MessageDetailPageClient.tsx`, `components/ComposeMessagePageClient.tsx`).
 *
 * Exposed spot IDs (additive contract per BACKWARD_COMPATIBILITY.md §6):
 *   - `data-table:messages:columns`              — auto-wired by `DataTable extensionTableId="messages"`
 *   - `data-table:messages:row-actions`          — auto-wired by `DataTable extensionTableId="messages"`
 *   - `data-table:messages:bulk-actions`         — auto-wired by `DataTable extensionTableId="messages"`
 *   - `data-table:messages:filters`              — auto-wired by `DataTable extensionTableId="messages"`
 *   - `data-table:messages:search-trailing`      — auto-wired by `DataTable extensionTableId="messages"`
 *   - `data-table:messages:toolbar`              — auto-wired by `DataTable extensionTableId="messages"`
 *   - `detail:messages:message:body:after`       — placed in `MessageDetailPageClient.tsx`
 *   - `detail:messages:message:sidebar`          — placed in `MessageDetailPageClient.tsx`
 *   - `crud-form:messages:message:fields`        — placed in `ComposeMessagePageClient.tsx` as a standalone widget mount above the composer (NOT CrudForm field resolution; the compose page is not a CrudForm)
 *
 * The `communication_channels` hub (SPEC-045d) is the primary consumer of these spots,
 * injecting channel badges, channel payload renderers, reaction bars, channel info
 * sidebars, and composer capability adapters.
 */
export const injectionTable: ModuleInjectionTable = {}

export default injectionTable
