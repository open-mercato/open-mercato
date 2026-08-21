import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  PrivacyDataClassHandler,
  PrivacyEnvironmentSanitizationInput,
} from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import {
  AiAgentPromptOverride,
  AiChatConversation,
  AiChatConversationParticipant,
  AiChatMessage,
  AiModerationFlag,
  AiPendingAction,
} from './data/entities'

export const AI_ASSISTANT_CONTENT_DATA_CLASS_ID = 'ai_assistant.content'

registerPrivacyDataClass({
  id: AI_ASSISTANT_CONTENT_DATA_CLASS_ID,
  module: 'ai_assistant',
  title: 'AI Assistant content',
  description: 'Conversation, prompt override, moderation, and pending-action content.',
  handlerService: 'aiAssistantEnvironmentPrivacyHandler',
  subjectKinds: [],
  subjectActions: [],
  environmentSanitization: { categories: ['ai_content', 'personal_data'] },
})

export class AiAssistantEnvironmentPrivacyHandler implements PrivacyDataClassHandler {
  constructor(private readonly em: EntityManager) {}

  async sanitizeEnvironment(input: PrivacyEnvironmentSanitizationInput) {
    const matched = await this.countContent(input)
    if (input.dryRun || matched === 0) return { matched, affected: 0 }
    const scope = this.scope(input)
    await this.em.nativeDelete(AiChatMessage, scope)
    await this.em.nativeDelete(AiChatConversationParticipant, scope)
    await this.em.nativeDelete(AiChatConversation, scope)
    await this.em.nativeDelete(AiPendingAction, scope)
    await this.em.nativeDelete(AiAgentPromptOverride, scope)
    await this.em.nativeDelete(AiModerationFlag, scope)
    return { matched, affected: matched }
  }

  async verifyEnvironmentSanitization(input: PrivacyEnvironmentSanitizationInput) {
    const content = await this.countContent(input)
    const findings = content > 0
      ? [{ code: 'ai_assistant.content_present', count: content }]
      : []
    return { passed: findings.length === 0, findings }
  }

  private async countContent(input: PrivacyEnvironmentSanitizationInput): Promise<number> {
    const scope = this.scope(input)
    const counts = await Promise.all([
      this.em.count(AiChatMessage, scope),
      this.em.count(AiChatConversationParticipant, scope),
      this.em.count(AiChatConversation, scope),
      this.em.count(AiPendingAction, scope),
      this.em.count(AiAgentPromptOverride, scope),
      this.em.count(AiModerationFlag, scope),
    ])
    return counts.reduce((total, count) => total + count, 0)
  }

  private scope(input: PrivacyEnvironmentSanitizationInput) {
    return {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    }
  }
}
