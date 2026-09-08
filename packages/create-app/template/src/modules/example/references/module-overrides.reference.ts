/**
 * Compileable `entry.overrides` reference for the unified module override surface.
 *
 * WHY IT LIVES HERE, AND NOT ONLY IN `src/modules.ts`
 * --------------------------------------------------
 * The app registry carries a `moduleOverrideExamples` constant, but two of the three
 * built-in scaffold presets replace `src/modules.ts` wholesale:
 * `packages/create-app/src/lib/apply-starter-preset.ts` writes the file from
 * `templates/modules-ts.template`, whose `ModuleEntry` type does not even declare an
 * `overrides` field. An app scaffolded with `empty` or `crm` therefore ships with no
 * typed override example at all, while this module's source ships in every preset.
 * Keeping the reference inside `references/` is what makes it survive that rewrite.
 *
 * WHAT IT IS
 * ----------
 * One typed, exhaustively commented `ModuleOverrides` value covering all sixteen wired
 * domains. It is **inert by construction**: nothing imports it into a `ModuleEntry`, so
 * the dispatcher never sees it in a running app. It compiles against the real
 * `ModuleOverrides` interface, so a domain that is renamed or retyped upstream breaks
 * the build here instead of silently rotting in a markdown snippet.
 *
 * HOW IT REACHES THE RUNTIME WHEN YOU DO USE IT
 * ---------------------------------------------
 * `applyModuleOverridesFromEnabledModules` (`@open-mercato/shared/modules/overrides`)
 * buckets each `entry.overrides.<domain>` by domain in module-load order and hands the
 * bucket to that domain's registered applier. A domain with no applier is skipped with
 * a one-shot structured warning, so an override you write for an unwired domain fails
 * loudly rather than pretending to work. `bootstrap.ts` calls the dispatcher exactly
 * once, before any registry first-loads.
 *
 * THE THREE RULES THAT DECIDE WHETHER YOUR OVERRIDE FIRES
 * -------------------------------------------------------
 * 1. **`null` disables, an object replaces.** Every keyed map in here follows the same
 *    convention. `extensions` under `ai` is the documented exception: it is an additive
 *    array, so null-map semantics do not apply to it.
 * 2. **The key must name something that already exists, and what happens when it does
 *    not depends on the domain AND on the value.** Every domain the shared dispatcher
 *    applies (`packages/shared/src/modules/overrides.ts` → `warnStaleOverrides`) skips
 *    an unmatched key and logs `Override did not match any registered entry`; that is
 *    why `acl.ts` still declares `example.manage` even though the app registry nulls
 *    it. The `ai` domain splits on the value: a NON-NULL value under an unknown key is
 *    REGISTERED as a brand-new entry — `applyToolOverrideMap` adds the tool with no
 *    warning at all, `applyAgentOverrideMap` adds the agent and logs
 *    `Override registers a new agent` — whereas a `null` under an unknown key, the
 *    disable shape every `ai` key below uses, deletes an entry that was never there:
 *    a no-op with no warning of any kind, not even the stale-key one the shared
 *    dispatcher would emit. So a typo is a silent no-op everywhere except a non-null
 *    `ai` override, where it silently invents a contract.
 *
 *    TypeScript cannot check any of these keys — they are plain strings — so
 *    `__tests__/module-overrides-reference.test.ts` cross-checks every key in this file
 *    against the ids the module really declares. Adopt that test with the shape.
 * 3. **Tier order is fixed.** Programmatic calls (for example `applyAiToolOverrides`)
 *    beat `modules.ts` entries, which beat per-module file exports such as this
 *    module's own `aiAgentOverrides` / `aiToolOverrides`, which beat the base
 *    declaration. A module ships a default; the app has the last word.
 *
 * @see ../../../modules.ts — the same shape wired into a real `ModuleEntry`
 * @see ../ai-agents.ts, ../ai-tools.ts — the per-module file tier of the `ai` domain
 * @see .ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md
 */
import type { ModuleOverrides } from '@open-mercato/shared/modules/overrides'

/**
 * Ids used below are this module's own on purpose: a reference you can paste into a
 * scaffolded app must not name a contract from a package that app may not install.
 * Rename every one of them when you adopt the shape.
 */
export const exampleModuleOverridesReference: ModuleOverrides = {
  // AI agents and tools. `agents`/`tools` are keyed replace-or-disable maps;
  // `extensions` is additive and never takes `null`.
  ai: {
    agents: { 'example.todo_assistant': null },
    tools: { 'example.get_todo_summary': null },
    extensions: [],
  },
  // API routes are keyed `'METHOD /api/path'`; pages are keyed by pathname. A page
  // override disables or replaces the route manifest entry, which is a different
  // mechanism from `guards` below.
  routes: {
    api: { 'DELETE /api/example/todos': null },
    pages: { '/backend/todos': null },
  },
  // Keyed by subscriber id, not by event id: one event may have several subscribers
  // and disabling the event itself is not what this domain does. Subscriber ids use a
  // COLON separator (`<module>:<subscriber>`) while event ids use dots — copying the
  // event id here produces a key that matches nothing.
  events: {
    subscribers: { 'example:audit-delete': null },
  },
  // Keyed by the worker's queue-qualified id.
  workers: { 'example:todos-bulk-complete': null },
  // Three independent widget registries. `injection` takes widget ids, `components`
  // takes `ComponentReplacementHandles` strings, `dashboard` takes dashboard widget ids.
  widgets: {
    injection: { 'example.injection.customer-priority-detail': null },
    components: { 'section:ui.detail.NotesSection': null },
    dashboard: { 'example.dashboard.todos': null },
  },
  // Notification *types* and their reactive *handlers* are separate registries; a type
  // can survive while its toast handler is disabled.
  notifications: {
    types: { 'example.umes.actionable': null },
    handlers: { 'example.umes.actionable-toast': null },
  },
  // API request interceptors, keyed by interceptor id.
  interceptors: { 'example.block-test-todos': null },
  // Command interceptors run around command execution and are a different registry
  // from the API interceptors above.
  commandInterceptors: { 'example.audit-logging': null },
  // Response enrichers that decorate another module's list/detail payloads.
  enrichers: { 'example.customer-todo-count': null },
  // Page middleware — the `guards` domain covers `backend/middleware.ts` and
  // `frontend/middleware.ts` declarations, keyed by the middleware id. A page
  // middleware is NOT a mutation guard; `data/guards.ts` is a different contract with
  // no override domain of its own.
  guards: {
    'example.backend.todo-edit-id-guard': null,
    'example.frontend.blog-canonical-id': null,
  },
  // Module CLI subcommands, keyed `'<module> <command>'` — the `command` field of the
  // entry in `cli.ts`, not the name of the script that invokes it.
  cli: { 'example seed-todos': null },
  // Setup is not a keyed map: it is a small flag shape read by the tenant-init hooks.
  setup: {
    seedExamples: false,
  },
  // ACL features, keyed by feature id. The feature must still be declared by the
  // module's `acl.ts` or the override is dropped as stale.
  acl: {
    features: { 'example.manage': null },
  },
  // DI registrations, keyed by the Awilix registration name.
  di: { exampleTodoSummaryService: null },
  // At-rest encryption maps, keyed by entity id.
  encryption: {
    maps: { 'example:todo': null },
  },
  // `nav` is framework-only: it reorders sidebar groups and has no per-module keyed
  // map. It is applied beneath role and per-user sidebar preferences.
  nav: {
    groupOrder: ['example.nav.group'],
  },
}

export default exampleModuleOverridesReference
