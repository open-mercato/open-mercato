---
name: trim-unused-modules
description: Propose disabling modules in src/modules.ts that the current standalone project does not actually use. Intended to be offered after the user adds a new custom module, because a fresh create-mercato-app scaffold enables every built-in module (classic mode) and that is rarely what the project actually needs in production.
---

# Trim Unused Modules

A fresh `create-mercato-app` scaffold enables every built-in Open Mercato module by default (classic mode) so that the app "just works" on day one. Once the user has added a new custom module and knows what they actually want to build, many of those defaults are dead weight — they slow down `yarn dev`, pollute the navigation sidebar, pull in unnecessary dependencies, and show the user features that will confuse their end users.

Invoke this skill when:

- The user just added a new module to `src/modules.ts` via `yarn mercato module add …` or by hand-creating `src/modules/<name>/`.
- The user asks "which modules do I really need?" or "how do I slim down the app?"
- You notice during another task that `src/modules.ts` still has every built-in module enabled AND the user's business domain clearly does not need some of them (e.g. a blog-only app with `sales`, `catalog`, `currencies`, `workflows`, `integrations`, `data_sync` all active).

## Workflow

1. **Never disable modules silently.** Always confirm with the user via `AskUserQuestion` before editing `src/modules.ts`.

2. **Read the current module list.** Parse `src/modules.ts`. For each entry:
   - Record the module `id` and its source (`@open-mercato/core`, `@open-mercato/<package>`, `@app`).
   - Flag entries with `from: '@app'` as **user modules** — never propose disabling these.
   - Flag entries with `from: '@open-mercato/…'` as **built-in modules** — eligible for review.

3. **Gather usage signals.** For each built-in module, check:
   - Is the module's feature ID referenced in `src/modules/**/acl.ts` or `src/modules/**/setup.ts`?
   - Is a type/name from the module imported anywhere in `src/**`?
   - Does any subscriber/worker declaration in `src/modules/**` reference an event ID the module owns?
   - Does the backend sidebar config reference routes from the module?
   - Is the module listed as a hard dependency in any enabled integration provider's manifest?
   Record yes/no per signal. If ALL signals return "no", mark the module as a **removal candidate**.

4. **Mark hard-required modules.** Never propose disabling modules that other parts of the framework rely on by convention. The baseline set that should stay enabled in almost every project:
   - `auth`, `customer_accounts`, `entities`, `configs`, `organizations`, `tenants`, `users`
   Include any module that another enabled module's `setup.ts` declares as a dependency.

5. **Present the proposal.** Use `AskUserQuestion` with a multi-select list of removal candidates. Include:
   - The module ID and a one-line description of what it does.
   - Which usage signals came back negative.
   - Whether disabling it will require running DB operations (e.g. dropping its tables — NOT something this skill performs; flag it so the user knows).

6. **Apply the user's choices.** For each module the user confirms:
   - Remove the entry from `src/modules.ts`.
   - Do NOT delete files from `node_modules/@open-mercato/*` (packages stay installed — disabling just means the app no longer loads them).
   - Do NOT drop the module's database tables. Data removal is a separate, destructive operation that the user must request explicitly.

7. **Re-run the generator.** After the edit:

   ```bash
   yarn generate
   ```

   This regenerates `.mercato/generated/*` without the disabled modules and triggers the best-effort structural cache purge.

8. **Report.** Print a short summary:
   - Which modules were disabled.
   - Which modules were kept (and the signal that kept each).
   - Reminder that package dependencies are still installed and module tables still exist; if the user wants to fully remove a module, they must uninstall the package and manually drop its tables.

## Constraints

- NEVER remove a `from: '@app'` entry.
- NEVER remove `auth`, `customer_accounts`, `entities`, `configs`, `organizations`, `tenants`, or `users`.
- NEVER delete files from `node_modules/` or from `src/modules/<mod>/` on behalf of the user — only edit `src/modules.ts`.
- NEVER drop database tables.
- If the user answers "no" to every removal candidate, exit quietly and note that classic mode is preserved.

## When NOT to run this skill

- In a monorepo development environment (`apps/mercato/src/modules.ts`) — the monorepo deliberately keeps every module enabled for framework development.
- On an imported ready app (`--app` or `--app-url`) — those snapshots are curated by their authors.
- During a `yarn dev` run — disabling modules while the server is live can cause transient errors. Ask the user to stop `yarn dev`, run the skill, then restart.
