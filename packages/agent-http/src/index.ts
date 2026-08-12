export { metadata } from './modules/agent_http/index'

// The connector seam, re-exported so a downstream app can register its own
// external agents against this connector — or build a second connector for a
// second endpoint — without reaching into module internals.
export {
  createGenericHttpConnector,
  GENERIC_HTTP_CONNECTOR_ID,
  GenericHttpConfigError,
  GenericHttpStartRejectedError,
} from './modules/agent_http/lib/connector'
export type { GenericHttpConnectorDeps } from './modules/agent_http/lib/connector'

export {
  httpAgentInputSchema,
  httpAgentOutcomeSchema,
  httpAgentResultSchema,
} from './modules/agent_http/data/validators'
export type {
  HttpAgentInput,
  HttpAgentOutcome,
  GenericHttpCallResult,
} from './modules/agent_http/data/validators'

export { AGENT_HTTP_INTEGRATION_ID } from './modules/agent_http/integration'

export {
  DEFAULT_REQUEST_TEMPLATE,
  REQUEST_TEMPLATE_CREDENTIAL_KEY,
  parseGenericHttpCredentials,
  GenericHttpCredentialsError,
} from './modules/agent_http/lib/credentials'
export type {
  GenericHttpCredentials,
  GenericHttpSignatureScheme,
} from './modules/agent_http/lib/credentials'

// The signing rule, exported so the OTHER side of the integration can be built
// against the same implementation instead of a second hand-written copy of it —
// a provider stub, an operator's smoke script, an integration test.
export {
  buildSignatureHeaderValue,
  verifyGenericHttpSignature,
} from './modules/agent_http/lib/signature'

export { renderRequestTemplate } from './modules/agent_http/lib/template'
export { readJsonPath } from './modules/agent_http/lib/jsonPath'
