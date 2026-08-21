import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ChannelPayloadRendererWidget from './widget.client'

/**
 * Channel payload renderer — renders the channel-native rich payload of a message
 * (Slack Block Kit, WhatsApp interactive, email MIME, etc.) below the body in the
 * messages detail page (`detail:messages:message:body:after`).
 *
 * For `email/*` content types, HTML is sanitized server-side by the
 * channel-payload enricher (`data/enrichers.ts`, via `sanitizeChannelHtml`) and
 * delivered as `_channelPayload.sanitizedHtml`, which this widget renders with
 * `dangerouslySetInnerHTML` — keeping `sanitize-html` off the client bundle.
 * See SPEC-045d §4.6.
 *
 * Provider packages override this via UMES component replacement (handle
 * `widget:communication_channels.injection.channel-payload-renderer`) to render
 * Block Kit, interactive buttons, contact cards, location maps, etc.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'communication_channels.injection.channel-payload-renderer',
    title: 'Channel payload renderer',
    description:
      'Renders channel-native rich payload (Block Kit, interactive, MIME) below the message body in the detail view. Generic fallback; provider packages can replace it for richer rendering.',
    features: ['communication_channels.view'],
    priority: 100,
    enabled: true,
  },
  Widget: ChannelPayloadRendererWidget,
}

export default widget
