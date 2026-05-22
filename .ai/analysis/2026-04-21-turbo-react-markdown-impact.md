# Turbo And React-Markdown Impact Analysis

Date: 2026-04-21
Branch: `release/v0.5.0`
Commit: `0df97d529`
Compared against: `develop`

## Summary

The relevant dependency jumps are:

- `turbo`: manifest `^2.3.3` on `develop` -> `^2.9.6` on current branch
- Installed `turbo`: `2.7.5` -> `2.9.6`
- `react-markdown`: manifest `^9.0.0` on `develop` -> `^10.1.0` on current branch
- Installed `react-markdown`: `9.1.0` / `9.0.3` -> `10.1.0`

This is not just a dependency bump. The branch also changes Turbo behavior materially:

- root `turbo.json` moved from `globalPassThroughEnv: ["*"]` to `globalEnv: ["NODE_ENV"]`
- `build` changed from uncached to cached
- `typecheck` changed from uncached to cached
- root concurrency was set to `32`
- `watch:packages` moved off `--parallel` and now uses `--concurrency=32`
- `apps/mercato/turbo.json` was added to scope app build outputs to `.mercato/next/**`

## Repo Evidence

- Current `turbo` version: [package.json](/Users/piotrkarwatka/Projects/mercato-development-two/package.json:155)
- Current Turbo config: [turbo.json](/Users/piotrkarwatka/Projects/mercato-development-two/turbo.json:1)
- App-specific Turbo config: [apps/mercato/turbo.json](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/turbo.json:1)
- Current `react-markdown` version: [packages/ai-assistant/package.json](/Users/piotrkarwatka/Projects/mercato-development-two/packages/ai-assistant/package.json:97)
- In-repo `react-markdown` wrapper: [packages/ui/src/backend/markdown/MarkdownContent.tsx](/Users/piotrkarwatka/Projects/mercato-development-two/packages/ui/src/backend/markdown/MarkdownContent.tsx:1)
- Upgrade note for `react-markdown`: [UPGRADE_NOTES.md](/Users/piotrkarwatka/Projects/mercato-development-two/UPGRADE_NOTES.md:152)

Develop baseline:

- Previous `turbo` version reference: `package.json` on `develop` line 154
- Previous Turbo config used `globalPassThroughEnv: ["*"]` and had uncached `build` / `typecheck`
- Previous `react-markdown` version reference: `packages/ai-assistant/package.json` on `develop` line 97

## React-Markdown: Important And Non-Backward-Compatible Changes

The important breaking change for this repo is the `v10` removal of the `className` prop on `<ReactMarkdown>`.

Before:

```tsx
<ReactMarkdown className="prose" remarkPlugins={plugins}>{body}</ReactMarkdown>
```

After:

```tsx
<div className="prose">
  <ReactMarkdown remarkPlugins={plugins}>{body}</ReactMarkdown>
</div>
```

Impact on this branch:

- This branch already adapted to that break.
- The shared markdown renderer now wraps the rendered markdown in a `<div className={className}>`.
- I checked for active usage of removed v9-era props such as `transformImageUri`, `transformLinkUri`, `linkTarget`, `sourcePos`, and `rawSourcePos` and did not find active in-repo usage that would make this branch fail.

Performance impact:

- Negligible for TypeScript compilation or monorepo scheduling.
- Mostly a runtime rendering dependency.
- In this repo, markdown rendering is dynamically imported in the shared UI wrapper, so there is no obvious compile-time regression from this bump.

Conclusion:

- `react-markdown` is backward-incompatible in API shape, but the repo-level impact is already fixed.
- I do not see a meaningful build-performance or compilation-performance regression caused by `react-markdown`.

## Turbo: Important Changes

### 1. Strict env behavior now matters

The biggest practical change is that the repo no longer behaves like "allow every env var everywhere".

`develop`:

```json
{
  "globalPassThroughEnv": ["*"]
}
```

Current branch:

```json
{
  "concurrency": "32",
  "globalEnv": ["NODE_ENV"]
}
```

That means Turbo now runs with much stricter env handling and caching expectations.

Real risk:

- tasks may depend on undeclared env vars
- those vars may not be part of the task hash
- cache hits can become stale or incorrect when env values change

This repo clearly uses many env vars across build and runtime paths, including:

- `APP_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_API_BASE_URL`
- `DATABASE_URL`
- `OPENAI_API_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `REDIS_URL`
- several `NEXT_PUBLIC_*` feature flags

The current Turbo config only declares `NODE_ENV` globally and does not include `.env*` in task inputs.

That is the main correctness risk of the Turbo migration.

### 2. Caching was enabled for `build` and `typecheck`

Current branch:

- `build.cache = true`
- `typecheck.cache = true`

This should improve repeat performance materially:

- repeated builds should be faster
- repeated typechecks should be faster
- local developer loops and CI reruns should benefit

I ran `yarn turbo run build --dry=json` and observed local cache hits already being resolved in the plan output, which confirms the cache path is active.

### 3. App outputs are now better scoped

The new [apps/mercato/turbo.json](/Users/piotrkarwatka/Projects/mercato-development-two/apps/mercato/turbo.json:1) narrows app build outputs to:

- `.mercato/next/**`
- excluding `.mercato/next/cache/**`

That is better aligned with the current app build layout and should improve cache usefulness and reduce ambiguity compared with generic root-level `.next/**` assumptions.

### 4. `--parallel` was removed from watch usage

This is a good change.

The current Turborepo docs mark `--parallel` as deprecated and warn that it discards the task dependency graph, which harms ordering and cache correctness. The branch moved package watch to:

```bash
turbo run watch --filter='./packages/*' --concurrency=32
```

That preserves high throughput without opting out of dependency awareness.

### 5. Upstream Turbo runtime got faster

Upstream Turborepo 2.9 claims major reductions in "time to first task", with up to 96% improvement on their benchmarks. That should help command startup overhead, especially in larger repos.

I would treat that as a probable benefit, not a guaranteed repo-specific number.

## Performance Assessment

### Expected improvements

- Better repeated `build` performance because caching is now enabled
- Better repeated `typecheck` performance because caching is now enabled
- Lower scheduler overhead from newer Turbo versions
- Better output scoping for the app build cache
- Better watch behavior after removing deprecated `--parallel`

### Main regression risk

The main risk is not raw speed. It is cache correctness.

Because the repo moved from broad env passthrough to strict hashing assumptions, any undeclared environment variable used during a build can cause:

- stale cache hits
- wrong build artifacts reused across environments
- surprising build differences between local and CI

This is especially relevant because the current config does not include `.env`, `.env.*`, or additional task `env` declarations.

### Compilation-performance conclusion

- Turbo itself should improve compile orchestration performance overall.
- `react-markdown` should have no meaningful effect on compile performance.
- The biggest real-world issue to watch is not slower compilation, but incorrect reuse of cached compilation outputs when env values change.

## Risk Ranking

1. High: Turbo env/caching correctness risk due to undeclared env vars and missing `.env*` inputs
2. Medium: Turbo behavior changes around strict env mode may break specific tasks if they rely on undeclared vars
3. Low: `react-markdown` API breakage, because the `className` migration is already handled in-repo
4. Low: `react-markdown` performance impact

## Recommendation

If you want this branch to be safer, the next step is to audit Turbo env coverage for `build` tasks and add:

- task-level `env` entries where needed
- `globalDependencies` or task `inputs` for `.env*`
- app-specific env declarations for values that change build output

Without that, the branch is likely faster on repeated runs, but also more exposed to cache correctness bugs than `develop`.

## External References

- `react-markdown` changelog: https://github.com/remarkjs/react-markdown/blob/main/changelog.md
- Turborepo run docs: https://turborepo.dev/docs/reference/run
- Turborepo env docs: https://turborepo.dev/docs/crafting-your-repository/using-environment-variables
- Turborepo 2.9 blog: https://turborepo.dev/blog/2-9
