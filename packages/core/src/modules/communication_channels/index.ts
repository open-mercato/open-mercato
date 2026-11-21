export const metadata = {
  id: 'communication_channels',
  title: 'Communication Channels',
  description:
    'Unified hub bridging external chat/email channels (Slack, WhatsApp, Email) to the Messages module. Adapter contract, channel-native payload storage, reactions, and per-channel threading. OAuth state cookies are single-use via short-TTL cache markers (see lib/oauth-state.ts); multi-replica deployments MUST set CACHE_STRATEGY=redis so replay protection is shared across replicas.',
}

export default metadata
