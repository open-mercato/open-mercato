import { asClass, asFunction, asValue } from 'awilix'
import type { AwilixContainer } from 'awilix'
import { toolRegistry } from './lib/tool-registry'
import { createModerationService } from './lib/moderation'
import { createContentSafetyService } from './lib/content-safety'
import { AiAssistantEnvironmentPrivacyHandler } from './privacy'

export function register(container: AwilixContainer): void {
  container.register({
    mcpToolRegistry: asValue(toolRegistry),
    // Input pre-moderation service (OpenAI /v1/moderations). Singleton +
    // overridable by downstream apps via the module overrides DI seam.
    moderationService: asFunction(() => createModerationService()).singleton(),
    contentSafetyService: asFunction(() => createContentSafetyService()).singleton(),
    aiAssistantEnvironmentPrivacyHandler: asClass(AiAssistantEnvironmentPrivacyHandler).scoped(),
  })
}
