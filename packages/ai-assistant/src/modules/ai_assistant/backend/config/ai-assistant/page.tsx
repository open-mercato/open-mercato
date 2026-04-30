import { redirect } from 'next/navigation'

/**
 * The AI section's root URL (`/backend/config/ai-assistant`) used to render
 * the legacy command palette settings page; that legacy surface now lives at
 * `/backend/config/ai-assistant/legacy`. Make the section root point to the
 * AI Agents list, which is the canonical entrypoint for the framework.
 */
export default async function AiAssistantSectionRoot() {
  redirect('/backend/config/ai-assistant/agents')
}
