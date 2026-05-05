import { redirect } from 'next/navigation'

/**
 * The AI section's root URL (`/backend/config/ai-assistant`) used to render
 * the legacy command palette settings page; that legacy surface now lives at
 * `/backend/config/ai-assistant/legacy`. Make the section root point to the
 * AI Agents list, which is the canonical entrypoint for the framework.
 *
 * `redirect()` throws (its return type is `never`) so the function never
 * yields a real value, but Next.js infers `Promise<void>` here unless we
 * pin the return to `Promise<never>` — and React's page-component contract
 * rejects `void`. Declaring it explicitly keeps the generated route map
 * happy without forcing a no-op `return null` after a non-returning call.
 */
export default async function AiAssistantSectionRoot(): Promise<never> {
  redirect('/backend/config/ai-assistant/agents')
}
