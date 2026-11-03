import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

/**
 * Preview-UI flag for the agent orchestrator cockpit.
 *
 * Several cockpit surfaces were built ahead of their backend: buttons with no
 * handler, toast-only actions, and panels rendering illustrative figures. They
 * are OFF by default so a deployment never shows a control that cannot do what
 * it promises; a deployment that wants to keep previewing the target UX sets
 * the env var.
 *
 * Read as a bare `process.env.<NAME>` member expression: Next.js inlines
 * `NEXT_PUBLIC_*` at build time only for that exact form, so this must not be
 * refactored into a dynamic lookup or the client bundle always sees undefined.
 * The non-public twin covers server-rendered and CLI call sites.
 */
export function isAgentPreviewUiEnabled(): boolean {
  const raw =
    process.env.NEXT_PUBLIC_OM_AGENT_ORCHESTRATOR_PREVIEW_UI ??
    process.env.OM_AGENT_ORCHESTRATOR_PREVIEW_UI
  return parseBooleanWithDefault(raw, false)
}
