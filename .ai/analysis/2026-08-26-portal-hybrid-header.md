# Analysis — Customer Portal renders a logged-out header over logged-in content

Reported by: Jakub Godawa (demo). Symptom: entering the portal from a link
(Dash Portal / "Open Portal") with an active customer session shows the
**public header** (Log In / Sign Up, no sidebar) while the **page content** is
the authenticated dashboard. Entering through the normal login flow looks correct.

## Root cause

Two independent defects combine. Either alone is a bug; together they produce the hybrid.

### 1. The portal root `/{orgSlug}/portal` is classified as a public route

`apps/mercato/src/app/(frontend)/layout.tsx:19-22`

```ts
function isPublicPortalRoute(pathname: string): boolean {
  if (/^\/[^/]+\/portal\/?$/.test(pathname)) return true   // <-- portal root
  return PUBLIC_SUFFIXES.some((s) => pathname.endsWith(s))
}
```

and `layout.tsx:155-158`

```ts
authenticated={!isPublic && customerAuthMatchesUrlOrg}          // false at the root
customerAuth={customerAuthMatchesUrlOrg ? customerAuth : null}  // NOT gated by isPublic
```

So on `/{org}/portal` with a session that matches the URL org:

* `authenticated` → **false** → `PortalShell` takes the `if (!authenticated)`
  branch (`packages/ui/src/portal/PortalShell.tsx:261`) → public header/footer,
  no sidebar, `enableEventBridge={false}`, portal nav fetch skipped.
* `customerAuth` → **the real session** → `PortalProvider` initialises
  `auth.user` (`PortalContext.tsx:74-101`) → every page under it renders its
  authenticated variant.

The two props disagree by construction. The `isPublic` gate exists so a visitor
with no session (or a session for a *different* org) sees the landing page; it
was never meant to demote a session that *does* match the URL org.

### 2. The layout does not re-render on the client-side redirect, so the wrong value sticks

`packages/core/src/modules/portal/frontend/[orgSlug]/portal/page.tsx:24-28`
redirects a logged-in visitor **client-side**:

```ts
useEffect(() => {
  if (!auth.loading && auth.user) router.replace(`/${orgSlug}/portal/dashboard`)
}, [...])
```

`(frontend)/layout.tsx` sits **above** the `[...slug]` segment — deliberately, so
portal navigation does not remount the client subtree (`layout.tsx:44-45`). A
client-side navigation between two routes under `[...slug]` therefore does not
re-render it, and `authenticated={false}` — computed for `/{org}/portal` — is
still in place once `/dashboard` mounts.

`PortalShell` cannot correct it either, because the prop unconditionally wins:

`PortalShell.tsx:181`
```ts
const authenticated = authenticatedProp ?? !!user   // prop is `false`, not undefined
```

So the public shell never self-heals, even though the context beside it holds a
real user.

### Why the normal path looks fine

Login redirects with a **full page load** — `login/page.tsx:50`
`window.location.assign(`/${orgSlug}/portal/dashboard`)` — so the layout runs
fresh on a non-public path, `isPublic === false`, `authenticated === true`.

## Reproduction

1. Log in to the portal at `/{org}/portal/dashboard`.
2. Open `/{org}/portal` (this is what the admin "Open Portal" button and any
   bare portal link point at).
3. The landing page redirects to `/dashboard`: dashboard content, public header.

## Blast radius (larger than the header)

* **Custom domains hit this on their front door.** `apps/mercato/src/proxy.ts:31`
  rewrites `/` → `/{orgSlug}/portal`, so every logged-in customer landing on
  `https://portal.example.com/` takes exactly this path.
* The admin "Open Portal" action links to the slug-less root
  (`customer_accounts/lib/portalUrl.ts:110` `buildPortalRootUrl`).
* Not cosmetic: `enableEventBridge={authenticated}` is false → **no portal SSE /
  realtime notifications** for the rest of that session, and the portal nav fetch
  (`PortalShell.tsx:206-231`) is skipped → **no sidebar**.

## Proposed fix

**A — root cause (server).** Stop demoting a session that matches the URL org at
the portal root. Split the root out of `isPublicPortalRoute` (keep it public for
the org lookup) and use it only where it belongs:

```ts
const isPortalRoot = /^\/[^/]+\/portal\/?$/.test(pathname)
...
const authenticatedChrome = customerAuthMatchesUrlOrg && (!isPublic || isPortalRoot)
authenticated={authenticatedChrome}
customerAuth={authenticatedChrome ? customerAuth : null}
```

The session prop must move with the chrome, not just the flag. With fix B below,
`PortalShell` lets a context user upgrade the shell — so leaving `customerAuth`
ungated (as it was) would hand the provider a session on `/portal/login` and
render the authenticated shell over the login form: the same prop/context
disagreement, mirrored. Gated together, login/signup/verify/reset/invite keep the
public chrome and the root follows the session.

**B — defense in depth (client).** Let the context upgrade the shell, so a stale
layout prop can never contradict the rendered content:

```ts
const authenticated = !!user || (authenticatedProp ?? false)
```

This closes the whole class of "stale layout above `[...slug]`" bugs, not just
this instance.

**C — optional.** Server-redirect `/{org}/portal` → `/dashboard` when a matching
session cookie is present, so the landing page is only ever rendered for
anonymous visitors and no client-side redirect is involved.

A alone fixes the report; A+B is the durable fix.

## Regression coverage to add

* `apps/mercato/src/app/(frontend)/__tests__/portal-org-binding.test.tsx` — new
  case: pathname `/org-a/portal` with a **matching** session →
  `authenticated: true` (today it is `false`). The existing `/org-b/portal`
  case, which asserts `authenticated: false` for a *mismatched* session, must
  keep passing.
* `packages/ui/src/portal/__tests__` — `PortalShell` with
  `authenticated={false}` but a context user renders the authenticated chrome.
* Integration: navigate `/{org}/portal` → `/dashboard` with a session, assert
  the header shows the user menu and not Log In / Sign Up.

## Files to change

* `apps/mercato/src/app/(frontend)/layout.tsx`
* `packages/create-app/template/src/app/(frontend)/layout.tsx` — **byte-identical
  today**; AGENTS.md "Template Sync Checklist" requires mirroring in the same task.
* `packages/ui/src/portal/PortalShell.tsx` (fix B)
