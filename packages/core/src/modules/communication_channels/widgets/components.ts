import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'

/**
 * Component override scaffold for the Communications Hub.
 *
 * Phase 4 of the email integration spec (`2026-05-21-email-integration-foundation`)
 * adds a `MessagesThreadDetailHeader` override for `channelType=email`. The shipping
 * Messages module renders the header via `MainMessageHeader` and does not yet expose
 * a registered component id — the header is rendered as a regular React component
 * in `MessageDetailPageClient.tsx`. The override mechanism (this file, plus the
 * `widgets/components.ts` auto-discovery convention) is wired and ready for the
 * Messages module to opt in by registering the component.
 *
 * Today, email-specific affordances (subject / Cc list / attachment count / Gmail
 * labels) are delivered to the Messages thread view via the
 * existing `detail:messages:message:body:after` injection spot's
 * `channel-payload-renderer` widget (slice 2e/2f). That widget renders the same
 * affordances the spec lists as header content, just below the header rather than
 * inside it. Surfacing them inside the header is the v2 upgrade path.
 *
 * Forward-compatible handle ids the hub will target once Messages exposes them:
 *   - `section:messages.detail.header`   — primary slot; the email override
 *                                         wraps it with the email banner above
 *                                         the default header.
 *   - `data-table:messages:row`          — secondary slot; email-channel rows
 *                                         get a small inline preview of the
 *                                         first-from name + envelope icon.
 *
 * Until Messages calls `registerComponent({ id: 'section:messages.detail.header', ... })`,
 * this file exports an empty array — the hub honors the override-mechanism
 * contract (downstream apps can target hub-side handles) without inventing
 * fictional component ids the Messages module doesn't surface.
 */
export const componentOverrides: ComponentOverride[] = []

export default componentOverrides
