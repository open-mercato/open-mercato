// Side-effect imports — register module commands at boot.
import './commands/ingest-inbound-message'
import './commands/deliver-outbound-message'
import './commands/process-inbound-reaction'
import './commands/toggle-outbound-reaction'
import './commands/reassign-conversation'
import './commands/connect-credential-channel'
import './commands/set-primary-channel'
import './commands/disconnect-channel'
import './commands/delete-channel'

export const metadata = {
  id: 'communication_channels',
  title: 'Communication Channels',
  description:
    'Unified hub bridging external chat/email channels (Slack, WhatsApp, Email) to the Messages module. Adapter contract, channel-native payload storage, reactions, and per-channel threading.',
}

export default metadata
