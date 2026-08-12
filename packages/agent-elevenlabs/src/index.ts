export { metadata } from './modules/agent_elevenlabs/index'

// The connector seam, re-exported so a downstream app can build its own external
// voice agent on the same connector without reaching into module internals.
export {
  createElevenLabsVoiceConnector,
  ELEVENLABS_VOICE_CONNECTOR_ID,
  CALLBACK_URL_VARIABLE,
  RESERVED_DYNAMIC_VARIABLE_PREFIX,
} from './modules/agent_elevenlabs/lib/connector'
export type { ElevenLabsVoiceConnectorDeps } from './modules/agent_elevenlabs/lib/connector'
export {
  voiceCallInputSchema,
  voiceCallOutcomeSchema,
  voiceCallResultSchema,
} from './modules/agent_elevenlabs/data/validators'
export type {
  VoiceCallInput,
  VoiceCallOutcome,
  VoiceCallResult,
} from './modules/agent_elevenlabs/data/validators'
export { ELEVENLABS_INTEGRATION_ID } from './modules/agent_elevenlabs/integration'
