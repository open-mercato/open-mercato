# Dev Splash "Start building" (Cezar) and Dev-Only Preview Framing

- **Issue:** [#7790](https://github.com/open-mercato/open-mercato/issues/7790)
- **Status:** Implemented (initial behavior)
- **Extends:** [`2026-08-18-dev-runtime-splash-and-gateway-diagnostics.md`](2026-08-18-dev-runtime-splash-and-gateway-diagnostics.md)

## TLDR

The shared development splash gets a **Start building** button that opens
[Cezar](https://github.com/open-mercato/cezar) for the current project by
starting plain `npx cezar-run` in a new interactive terminal. The button is
available while the app is still booting, during setup and after readiness.
No preview flag is invented and no agent task is submitted.

In the same change, `next dev` stops refusing to be framed by local origins, so
Cezar's Preview panel (a different `localhost` port) can show the running app.
Production headers are unchanged.

## Overview

The splash already offers a **Start coding with AI** menu (VS Code, Cursor,
Claude Code, Codex) once the app is ready. Cezar is a cockpit that runs and
tracks agent tasks in the repository; starting it should not wait for the first
compilation. The issue asks for the initial, independently shippable behavior:
plain `npx cezar-run`. The enhanced handoff (pass the resolved app URL so Cezar
opens Preview plus terminal) depends on
[open-mercato/cezar#1608](https://github.com/open-mercato/cezar/issues/1608)
and is out of scope here.

## Problem Statement

1. There is no one-click path from the splash to Cezar; users must find the
   command and the right directory themselves.
2. Even when Cezar is open, its Preview panel shows an empty frame because the
   app always sends `X-Frame-Options: SAMEORIGIN` and
   `Content-Security-Policy: frame-ancestors 'self'`, and Cezar serves its UI
   from another port (`http://127.0.0.1:4321` by default), which is a different
   origin.

## Proposed Solution

### Start building action

- New splash endpoint `POST /actions/start-building`, owned by the existing
  coding-flow module (`scripts/dev-splash-coding-flow.mjs`). It reuses every
  guard of `POST /actions/start-coding`: POST only (`405` otherwise), the
  loopback Host / splash Origin check (`assertLocalSplashRequest`, `403`), the
  per-run splash action token header `x-om-dev-splash-token` (`403`), the
  shared busy flag (`409`) and the 8 KiB JSON body limit (`400`).
- The request accepts **no parameters**. The body must be empty or `{}`; any
  field returns `400`. The browser never supplies a command, executable,
  directory or URL.
- The command is fixed server-side: the `npx` executable found on `PATH`
  (`npx.cmd` via `PATHEXT` on Windows) with the single argument `cezar-run`.
  It runs through the existing interactive-terminal launcher (Terminal.app via
  `osascript` on macOS, `cmd /k` on Windows, the first detected terminal
  emulator on Linux), so `npx` download and Cezar startup output stay visible
  and the terminal stays open afterwards.
- The project directory is resolved server-side by
  `resolveBuildingProjectDirectory`: the runtime passes the directory that
  holds its `scripts/` folder (`dev.mjs` and `dev-ephemeral.ts` both live in
  `<project>/scripts/`); the resolver walks up to the nearest directory with a
  `package.json` and falls back to the sanitized launch directory. This yields
  the monorepo root for `yarn dev` / `yarn dev:greenfield` /
  `yarn dev:ephemeral`, the app root for a generated app (`yarn setup` /
  `yarn dev`), and the worktree root when run from a git worktree.
- Duplicate clicks: the client ignores clicks while a request is in flight,
  the server rejects concurrent actions with `409`, and after a successful
  launch it rejects another launch for 5 s with `409` and code
  `already_started`, so a fast double click opens one Cezar.
- Availability is reported in the status snapshot so the splash can show an
  actionable message and the manual command instead of a failing button:
  `npx_missing` (no `npx` on `PATH`) or `terminal_missing` (no supported
  terminal launcher).
- `OM_ENABLE_CODING_FLOW_FROM_SPLASH=false` disables this endpoint together
  with the coding menu (the handler does not claim the route and the button is
  hidden).

### Splash UI

- A **Start building** button sits next to the login button in the status
  card. Unlike the coding menu it is not gated on `ready`; it shows during
  starting, setup, failed and ready states whenever the coding flow is
  enabled.
- A status line under the button shows starting / started / already started /
  busy / failed / unavailable messages. All strings are localized in the
  splash dictionaries (`en`, `pl`, `es`, `de`); server results carry a stable
  `code` that the client maps to a translation, with the English `message` as
  fallback.

### Dev-only preview framing

- `apps/mercato/next.config.ts` and `packages/create-app/template/next.config.ts`
  export a phase-aware config function and compute the frame policy from the
  Next.js phase:
  - `PHASE_DEVELOPMENT_SERVER` (`next dev`):
    `frame-ancestors 'self' http://localhost:* http://127.0.0.1:*` and **no**
    `X-Frame-Options` on the global `/:path*` rule;
  - every other phase (`next build`, `next start`, export): unchanged,
    `frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN`.
- The gate is the phase, not `NODE_ENV`. `mercato server dev` (what `yarn dev`
  runs) starts `next dev` with `NODE_ENV=production`, so a `NODE_ENV` gate never
  relaxes framing in the real dev flow; and `next build` keeps a preset `test`,
  `development` or custom `NODE_ENV` while writing the `headers()` result into
  the routes manifest that `next start` serves, so a `NODE_ENV` gate could ship
  the loopback policy in a production build. The phase has neither problem.
- The `/api/attachments/file/:path*` rule keeps its own sandbox CSP and
  `X-Frame-Options: SAMEORIGIN` in every mode.
- Only plain-HTTP loopback origins are added; no wildcard host, no `https:` or
  remote origin. IPv6 literals are not valid CSP host-sources and are not
  listed.

## Architecture

```text
splash (browser, :4000)
  └─ POST /actions/start-building  {}            x-om-dev-splash-token
       └─ dev-splash-coding-flow.handleRequest
            ├─ guards: method, assertLocalSplashRequest, token, busy, body
            ├─ resolveBuildingProjectDirectory(projectDir, launchDir)
            ├─ detectBuildingLauncher(env, platform) → npx path + terminal
            └─ launchInteractiveTerminal(npx, { args: ['cezar-run'], launchDir })
                 └─ new terminal: cd <project> && npx cezar-run
```

`dev.mjs` (monorepo and template, byte-identical) and `dev-ephemeral.ts` pass
`projectDir` to `createDevSplashCodingFlow`. The splash and the coding-flow
module are mirrored into `packages/create-app/template/scripts/` and checked by
`yarn template:sync`.

## Data Models

None. No entity, migration or persisted state. The cooldown timestamp and the
last result live in memory for one dev run.

## API Contracts

Splash server only (development, loopback). Additive.

- `POST /actions/start-building`
  - Request: empty body or `{}`; header `x-om-dev-splash-token`.
  - `200 { ok: true, codingFlow }` with
    `codingFlow.building.lastResult = { kind: 'success', code: 'started', message }`.
  - `400` invalid JSON, oversize body or any request field.
  - `403` foreign Host/Origin or invalid token.
  - `405` non-POST.
  - `409` another splash action is running (`code: 'busy'`) or Cezar was
    started less than 5 s ago (`code: 'already_started'`).
  - `500` launch failed or unavailable
    (`code: 'npx_missing' | 'terminal_missing' | 'failed'`), with the manual
    command in `codingFlow.building.manualCommand`.
- `GET /status` → `codingFlow.building` (additive, only when the coding flow is
  enabled): `{ available, reason, manualCommand, lastResult }`.
- `POST /actions/start-coding` and the existing `codingFlow` fields are
  unchanged.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| A web page triggers a local process launch | High | splash | Loopback Host + splash Origin check, per-run token, POST only, no parameters | Same as the existing coding launch; `OM_DEV_SPLASH_BIND=0.0.0.0` remains an explicit operator opt-in |
| Browser input changes the command or directory | High | splash | Endpoint takes no fields; command and directory are computed server-side; paths pass `assertShellSafePath` and POSIX/AppleScript/cmd quoting | None known |
| Double click opens two Cezar instances | Low | splash | Client in-flight flag, server busy flag, 5 s relaunch cooldown | A deliberate relaunch after 5 s opens another terminal; Cezar itself handles its port |
| Cezar port 4321 already used by another cockpit | Low | DX | Out of our control; Cezar output is visible in the opened terminal | User can run `npx cezar-run -p <port>` manually |
| Dev app framed by any local page | Low | dev only | Only `http://localhost:*` / `http://127.0.0.1:*` in development; production keeps `SAMEORIGIN` | Other local dev servers can frame the dev app, which already trusts loopback for HMR |
| Production build framed cross-origin | High | prod | Loopback framing only in the `next dev` phase; `next build` / `next start` phases always emit `frame-ancestors 'self'` + `SAMEORIGIN`, whatever `NODE_ENV` is (the production Dockerfile and Railway, which builds from it, run `next build`) | None known. Covered by tests on both configs for every phase and `NODE_ENV` combination |
| Forms `/embed/:slug` policy | Low | forms | The embed carve-out is not wired yet (see forms `page.meta.ts`); the change only widens dev framing to loopback, production stays fail-closed; `TC-FORMS-EMB-006/007` assert the embed-policy API, not global headers | None |

## Migration & Backward Compatibility

- Additive splash route and snapshot field; existing routes, payloads and
  `OM_ENABLE_CODING_FLOW_FROM_SPLASH` semantics are unchanged.
- No module export, event ID, DI key, ACL feature, API route or ORM schema
  changes. Production response headers are unchanged.
- The enhanced Cezar handoff will add arguments only after Cezar publishes a
  supported interface; older Cezar versions keep the plain invocation.

## Test Coverage

| Area | File |
| --- | --- |
| Project directory resolution, launcher detection, terminal arguments | `scripts/__tests__/dev-splash-coding-flow.test.mjs` |
| Route guards, parameter rejection, cooldown, launch via a stub terminal | `scripts/__tests__/dev-splash-coding-flow.handler.test.mjs` |
| Button markup, ungated rendering, locale keys, template parity | `scripts/__tests__/dev-splash-html.test.mjs` |
| Dev vs production frame headers (app and template) | `apps/mercato/src/__tests__/frame-security-headers.test.ts` |

Browser QA: load the splash during startup and after ready, click
**Start building**, confirm a terminal opens in the project root running
`npx cezar-run`, and that Cezar's Preview shows the dev app.

## Final Compliance Report

- No user-facing string is hard-coded outside the splash locale dictionaries.
- No browser-controlled command, path or URL.
- Template mirrored (`scripts/dev-splash.html`,
  `scripts/dev-splash-coding-flow.mjs`, `scripts/dev.mjs`, `next.config.ts`).
- Production behavior unchanged.

## Changelog

### 2026-10-23

- Added `POST /actions/start-building` and the **Start building** splash button
  launching plain `npx cezar-run` in the project root (monorepo, generated app,
  worktree, ephemeral).
- Allowed loopback origins to frame the app in development only, so Cezar's
  Preview panel can show it. The gate is the Next.js development-server
  phase, so `yarn dev` (which runs `next dev` with `NODE_ENV=production`) gets
  it and every `next build` keeps production headers.
