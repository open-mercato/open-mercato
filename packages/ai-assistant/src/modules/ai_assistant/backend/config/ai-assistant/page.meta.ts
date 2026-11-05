/**
 * The section root (`/backend/config/ai-assistant`) is a redirect to the AI
 * Agents page (see `page.tsx`). It MUST NOT appear in the sidebar — leaving
 * it out of the structural cache prevents the legacy "AI Assistant
 * (legacy)" entry from anchoring the AI section. The actual legacy surface
 * lives at `/backend/config/ai-assistant/legacy` with its own meta.
 */
export const metadata = {
  requireAuth: true,
  requireFeatures: ['ai_assistant.settings.manage'],
  navHidden: true,
} as const
