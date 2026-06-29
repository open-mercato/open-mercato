import * as React from 'react'
import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'
import ChannelBadgeWidget from './widget.client'

/**
 * Channel badge — renders the channel type/provider icon + label as a `<Tag>`
 * pill in the messages DataTable's columns spot (`data-table:messages:columns`).
 *
 * DataTable's column-injection contract requires a declarative `columns` array
 * of `InjectionColumnDefinition` — the registry filters out widgets that don't
 * expose `columns`. The cell renderer is a React component that reads the
 * `_channel` enrichment field added by `messageChannelEnricher`.
 *
 * Round-1/round-2 review trail: round-1 shipped this as an
 * `InjectionWidgetModule` with a top-level `Widget` component, which DataTable
 * silently skipped (`if (!('columns' in widget)) continue`). Round-2 R2-H6 / F7
 * (2026-05-26) converted it to the declarative column shape.
 *
 * Provider packages can override this widget via UMES component replacement
 * (`section:communication_channels.channel-badge`) to render brand-specific
 * badges (Slack logo, WhatsApp green badge, etc.).
 */
const widget: InjectionColumnWidget = {
  metadata: {
    id: 'communication_channels.injection.channel-badge',
    title: 'Channel badge',
    description:
      'Renders a channel-type/provider badge inline in the messages list. Visible whenever a message has an associated MessageChannelLink (= the message was bridged from or to an external channel).',
    features: ['communication_channels.view'],
    priority: 100,
    enabled: true,
  },
  columns: [
    {
      id: 'communication_channels.channel-badge',
      header: 'communication_channels.columns.provider',
      accessorKey: '_channel',
      size: 140,
      cell: ({ getValue }) => {
        const channel = getValue() as
          | { providerKey?: string; channelType?: string; direction?: string; deliveryStatus?: string | null }
          | null
          | undefined
        if (!channel) return null
        return React.createElement(ChannelBadgeWidget, { channel })
      },
    },
  ],
}

export default widget
