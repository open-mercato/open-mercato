# Upgrade Notes

This document lists backward-incompatible changes that users of the Open Mercato platform
must apply to their own modules, apps, and extensions when upgrading between framework
versions. It only covers **actionable** incompatibilities — library behavior that affects
code a downstream module author can plausibly write against.

For the platform's own contract-surface stability guarantees, see
[`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md).

For user-facing release highlights see [`CHANGELOG.md`](CHANGELOG.md).

Companion AI skills (one per upgrade window) live in
[`.ai/skills/auto-upgrade-<from>-<to>/SKILL.md`](.ai/skills/) and can mechanically migrate
most of the patterns listed below in a user's codebase.

---

## 0.4.10 → 0.5.0 (unreleased)

This window bundles the consolidated Dependabot dependency bumps from
[#1620](https://github.com/open-mercato/open-mercato/pull/1620) (minor/patch) and
[#1621](https://github.com/open-mercato/open-mercato/pull/1621) (major), migrated to
`develop` in [#1625](https://github.com/open-mercato/open-mercato/pull/1625).

Three major bumps with deep platform surface impact were **deliberately reverted** and are
**NOT** part of 0.5.0 — they remain on their 0.4.10 versions and are tracked as separate
dedicated upgrades. See [Deferred majors](#deferred-majors) below.

Companion skill: [`auto-upgrade-0.4.10-to-0.5.0`](.ai/skills/auto-upgrade-0.4.10-to-0.5.0/SKILL.md).

### Breaking dependency changes that may affect user code

#### `meilisearch` `^0.55` → `^1.0`

The exported client class was renamed from `MeiliSearch` to `Meilisearch` (lowercase `s`),
and the package switched to pure ESM (`"type": "module"`).

Code changes:

```ts
// before
import { MeiliSearch } from 'meilisearch'
const client = new MeiliSearch({ host, apiKey })

// after
import { Meilisearch } from 'meilisearch'
const client = new Meilisearch({ host, apiKey })
```

Jest configuration (ESM): Jest's default `transformIgnorePatterns` skips `node_modules`.
Since `meilisearch@1` ships pure ESM, add an allow-list so `ts-jest`/`babel-jest` can
transform it:

```js
// apps/<your-app>/jest.config.cjs
module.exports = {
  // ...
  transformIgnorePatterns: [
    '/node_modules/(?!meilisearch)/',
    '\\.pnp\\.[^\\/]+$',
  ],
}
```

#### `stripe` `^17` → `^22`

The `Stripe.LatestApiVersion` namespace constant was removed and the zero-argument
`stripe.accounts.retrieve()` was replaced by `stripe.accounts.retrieveCurrent()`.

Code changes:

```ts
// before
import Stripe from 'stripe'
const stripe = new Stripe(apiKey, {
  apiVersion: apiVersion as Stripe.LatestApiVersion,
})
const account = await stripe.accounts.retrieve()

// after
import Stripe from 'stripe'
type StripeConfig = NonNullable<ConstructorParameters<typeof Stripe>[1]>
const stripe = new Stripe(apiKey, {
  apiVersion: apiVersion as StripeConfig['apiVersion'],
})
const account = await stripe.accounts.retrieveCurrent()
```

Also bumped in lock-step: `@stripe/react-stripe-js` `^3` → `^6`, `@stripe/stripe-js`
`^7` → `^9`. Consult Stripe's own migration guides for component-level API changes.

#### `lucide-react` `^0.556` → `^1.8`

Brand icons `Linkedin` and `Twitter` were removed for trademark reasons. Replace with
a semantic substitute (the platform uses `Briefcase` for LinkedIn-style links and
`AtSign` for Twitter-style handles):

```tsx
// before
import { Linkedin, Twitter } from 'lucide-react'

// after
import { Briefcase, AtSign } from 'lucide-react'
```

Other lucide icon name stabilizations landed in the v1 cut — check your imports
against https://lucide.dev/icons if you see "module has no exported member" errors.

#### `react-markdown` `^9` → `^10`

The `className` prop was removed from `<ReactMarkdown>`. Wrap the invocation in a
`<div>` that carries the class instead:

```tsx
// before
<ReactMarkdown className="prose" remarkPlugins={plugins}>{body}</ReactMarkdown>

// after
<div className="prose">
  <ReactMarkdown remarkPlugins={plugins}>{body}</ReactMarkdown>
</div>
```

#### `cron-parser` `^4` → `^5`

The default-export factory was removed. `parseExpression` is no longer a function exposed
on the default import — use the named `CronExpressionParser.parse` static method:

```ts
// before
import parser from 'cron-parser'
const expr = parser.parseExpression('*/5 * * * *')

// after
import { CronExpressionParser } from 'cron-parser'
const expr = CronExpressionParser.parse('*/5 * * * *')
```

The returned iterator shape (`next()`, `prev()`, `hasNext()`, `hasPrev()`) is unchanged.

#### `@simplewebauthn/server` `^11` → `^13` (and `@simplewebauthn/types` `^11` → `^12`)

Function signatures were narrowed from `Uint8Array` to `Uint8Array<ArrayBuffer>`. A
`TextEncoder().encode(...)` result or a `new Uint8Array(Buffer.from(...))` result is
typed `Uint8Array<ArrayBufferLike>` and is no longer assignable. Coerce with `.slice()`:

```ts
// before
function toWebAuthnUserId(userId: string): Uint8Array {
  return new TextEncoder().encode(userId)
}
function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

// after
function toWebAuthnUserId(userId: string) {
  return new TextEncoder().encode(userId).slice()
}
function base64UrlToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64url')).slice()
}
```

Several exported types also moved from `@simplewebauthn/types@11` to `@simplewebauthn/types@12`.
If you imported passkey types directly, re-run `tsc` — the message is usually the rename is
transparent once the new version is installed.

#### `recharts` `^2` → `^3`

recharts 3 dropped several default props (e.g. `isAnimationActive`) and tightened the
`ResponsiveContainer` width/height typing. If you render charts in a custom module, expect
to audit any non-default props, particularly custom `Tooltip`/`Legend` content renderers,
which now receive slightly different payload shapes. No helper is provided here — review
https://recharts.org upgrade notes.

#### `rate-limiter-flexible` `^9` → `^11`

Two back-to-back major releases. The constructor options object is mostly compatible; the
main breakage is around the deprecated `pointsConsumed` return field and the strictened
Redis client option type (`useRedisPackage`/`storeClient` unioning). Audit any direct
consumers — the platform itself uses this transitively; user modules that wire their own
`RateLimiterRedis` instance are the ones to watch.

#### `framer-motion` `^11` → `^12`

Most `motion.<el>` call sites continue to work. The layout animation engine was rewritten
and some auto-animated layout transitions now behave slightly differently at the pixel
level. Bug-for-bug parity is not guaranteed; verify any long-running, scroll-triggered, or
gesture-driven animations after upgrading.

#### `glob` `^11` → `^13`

Node 20+ now required. The `Glob` class `matchBase` option was renamed to `matchBases`; the
function signature already accepted `signal` and `withFileTypes`. If you used the
`globSync()` one-shot helper, no code change is needed.

#### `esbuild` `^0.25` → `^0.28`

Only affects build tooling in workspace packages that ship a standalone bundle
(`packages/create-app`, `packages/cli`, `packages/checkout`, `packages/scheduler`,
`packages/webhooks`, `packages/sync-akeneo`). The 0.25→0.28 window made `--outdir` with a
non-existent directory error (previously it silently created it); ensure your build scripts
`mkdir -p` explicitly. No runtime behavior change.

#### `eslint` `^9` → `^10`

Flat config is now the only config format (`.eslintrc.*` is removed). If you still ship a
legacy `.eslintrc.js` in a user module, migrate it to `eslint.config.mjs`. ESLint 10 also
drops Node 18 support — make sure your CI runs Node 20+ at minimum.

#### `rimraf` `^5` → `^6`

Pure tooling change. The default-exported function is now async-only and no longer accepts
the legacy callback signature. If you invoke `rimraf` from a build script, `await` it.

#### `@docusaurus/*` `^3.9` → `^3.10`

Minor bump. No user code changes. The consolidation pins `webpack` to `5.104.1` via
root-level `resolutions` because `webpackbar@6.0.1` (a transitive of `@docusaurus/core@3.10`)
is incompatible with webpack `5.106.x`'s stricter `ProgressPlugin` schema. The pin can be
dropped once `webpackbar` ships a fix or Docusaurus bumps it.

#### AI SDK family

`@ai-sdk/amazon-bedrock` `^4.0.8` → `^4.0.96`, `@ai-sdk/anthropic` `^3.0.12` → `^3.0.71`,
`@ai-sdk/cohere` `^3.0.4` → `^3.0.30`, `@ai-sdk/google` `^2` → `^3`, `@ai-sdk/mistral`
`^3.0.5` → `^3.0.30`, `@ai-sdk/openai` `^3.0.5` → `^3.0.53`, `ai` `^6.0.0` → `^6.0.168`,
`ai-sdk-ollama` `3.0.0` → `3.8.3`.

`@ai-sdk/google` is the only major bump here. v3 renamed the default model factory export
and tightened the tool-call result shape; if you import `google` directly and call `.tool()`
or pass a custom fetch, verify against v3 release notes.

#### Miscellaneous smaller bumps (no known user-code impact)

- `next` `16.2.3` → `16.2.4`, `react`/`react-dom` `19.2.1` → `19.2.5`.
- `@tanstack/react-query` `^5.90.12` → `^5.99.2`.
- `@types/node` `^20`/`^24` → `^25`, `@types/react` `^19.2.7` → `^19.2.14`.
- `newrelic` `^13.16` → `^13.19`, `dotenv` `^17.2.3` → `^17.4.2`, `resend` `^6.5.2` → `^6.12.0`.
- `@tailwindcss/postcss` and `tailwindcss` `^4.1.17` → `^4.2.2`, `tailwind-merge` `^3.4.0` → `^3.5.0`.
- `better-sqlite3` `^12.5` → `^12.9`, `bullmq` `^5.34` → `^5.75`, `ioredis` `^5.8` → `^5.10`.
- `zod` `^4.1.13` → `^4.3.6`, `semver` `^7.7.3` → `^7.7.4`, `testcontainers` `^11.12` → `^11.14`.
- `jest` `^30.2` → `^30.3`, `jest-environment-jsdom` `^30.2` → `^30.3`, `ts-jest` `^29.4.6` → `^29.4.9`.
- `eslint-config-next` `16.1.7` → `16.2.4`.
- `@react-email/components` `^1.0.1` → `^1.0.12`, `react-email` `^5.2.10` → `^6.0.0`.
  react-email v6 changed the CLI entry from `email` to `react-email`; if you scripted the
  CLI, update the command name.
- `@uiw/react-markdown-preview` `^5.1.5` → `^5.2.0`, `@uiw/react-md-editor` `^4.0.11` → `^4.1.0`.
- `openid-client` `^6.3.3` → `^6.8.3`, `otpauth` `9.4.1` → `9.5.0`.
- `@modelcontextprotocol/sdk` `^1.26` → `^1.29`.

### Deferred majors

These majors were bumped by Dependabot but **reverted** before merging because their
migration cost crosses the platform's contract surface. They are not part of 0.5.0 and
are tracked as follow-up work:

| Package | Current pin | Dependabot proposed | Why deferred |
|---------|-------------|---------------------|--------------|
| `@mikro-orm/*` | `^6.6.10` | `^7.0.11` | v7 drops decorator re-exports and `persistAndFlush`/`removeAndFlush`, requires invasive migration across every `data/entities.ts` and all write paths |
| `typescript` | `^5.9.3` | `^6.0.3` | v6 deprecates `moduleResolution=node10` (`error TS5107`) across every package `tsconfig.json`; fix requires either `"ignoreDeprecations": "6.0"` everywhere or a real migration to `bundler`/`node16` |
| `awilix` | `^12.0.5` | `^13.0.3` | v13 changed the `Cradle` generic default from `any` to `{}`, which makes every `container.resolve('em')` return `unknown` at 100+ DI call sites with no code change |

When a dedicated spec and migration PR land for one of these, it will be listed in its own
`0.x.y → 0.x.(y+1)` window in this document and the corresponding `auto-upgrade-...` skill
will cover it.

---

## Template for future entries

```md
## X.Y.Z → X.Y.(Z+1) (unreleased)

Companion skill: [`auto-upgrade-X.Y.Z-to-X.Y.(Z+1)`](.ai/skills/auto-upgrade-X.Y.Z-to-X.Y.(Z+1)/SKILL.md).

### Breaking dependency changes that may affect user code

#### `<package>` `^<from>` → `^<to>`

<one paragraph describing the breakage>

```ts
// before
<...>

// after
<...>
```
```

When opening a PR that bumps a dependency across a major boundary, add an entry here in
the same PR. The `auto-upgrade-...` skill for the window picks up entries from this file;
keep the headings stable (exactly `#### \`<package>\` \`^<from>\` → \`^<to>\``) so the
skill can parse them.
