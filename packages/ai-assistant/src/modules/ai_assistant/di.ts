import { asClass, asFunction, asValue } from 'awilix'
import type { AwilixContainer } from 'awilix'
import { toolRegistry } from './lib/tool-registry'
import { createModerationService } from './lib/moderation'
import { createContentSafetyService } from './lib/content-safety'
import { createDecisionModelService } from './lib/decision-model-service'
import { createOpenCodeClient } from './lib/opencode-client'
import { AiAssistantEnvironmentPrivacyHandler } from './privacy'

export function register(container: AwilixContainer): void {
  container.register({
    mcpToolRegistry: asValue(toolRegistry),
    // Input pre-moderation service (OpenAI /v1/moderations). Singleton +
    // overridable by downstream apps via the module overrides DI seam.
    moderationService: asFunction(() => createModerationService()).singleton(),
    contentSafetyService: asFunction(() => createContentSafetyService()).singleton(),
    aiAssistantEnvironmentPrivacyHandler: asClass(AiAssistantEnvironmentPrivacyHandler).scoped(),
    // Decision model port (typed answers with probabilities). Singleton that
    // owns the only decision model registry; consumers resolve it soft-optionally.
    decisionModelService: asFunction(() => createDecisionModelService()).singleton(),
    // Injectable OpenCode client so the file-agent runner (and tests, via a
    // fake client) resolve it from DI instead of constructing it inline.
    // Production wiring uses the env-configured factory.
    openCodeClient: asFunction(() => createOpenCodeClient()).singleton(),
  })
}
