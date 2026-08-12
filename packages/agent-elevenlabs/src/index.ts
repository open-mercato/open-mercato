export { metadata } from './modules/agent_elevenlabs/index'

// The connector seam, re-exported so a downstream app can build its own external
// voice agent on the same connector without reaching into module internals.
export {
  createElevenLabsVoiceConnector,
  ELEVENLABS_VOICE_CONNECTOR_ID,
  ELEVENLABS_CALLBACK_PATH,
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
// The profile vocabulary, so a downstream app can register its own external
// voice agents against this tenant's named profiles.
export {
  DEFAULT_PROFILE_NAME,
  PROFILES_CREDENTIAL_KEY,
  parseElevenLabsCredentials,
  resolveCallProfile,
  listConfiguredProfileNames,
  ElevenLabsProfileNotConfiguredError,
} from './modules/agent_elevenlabs/lib/credentials'
export type {
  ElevenLabsCallProfile,
  ElevenLabsCredentials,
} from './modules/agent_elevenlabs/lib/credentials'
