# Contributing to Open Mercato

We’re excited to collaborate with folks building on top of Open Mercato. This guide explains how we organize releases, structure branches, and prepare pull requests so changes land smoothly.

## Branch Model

- `main` – release-ready code. Every commit is tagged and deployable. Keep PRs targeting `main` limited to hotfixes or release prep approved by maintainers.
- `develop` – nightly builds and upcoming release work. Base regular feature work off `develop` so it can soak in automation and shared testing.
- Topic branches – create a dedicated branch per change using the format `feat/<concise-feature-name>` (for example `feat/customer-export`). Use other prefixes when appropriate (`fix/`, `chore/`, `docs/`).

## Working on Features

- Branch from `develop`, keeping it up to date via `git pull --rebase origin develop`.
- Keep commits scoped and descriptive. Squash locally if it clarifies the story.
- Follow module conventions from [`AGENTS.md`](AGENTS.md) and prefer the `packages/` workspace for new code.
- Document user-facing copy in the locale dictionaries and keep translations in sync.

### Spec Driven Development

Before implementing new features or making significant changes, check for an existing spec in `.ai/specs/`:

1. **Check for a spec**: Look for specs named `{YYYY-MM-DD}-{title}.md` related to your feature
2. **Create or update**: If no spec exists, create one following the naming convention `{YYYY-MM-DD}-{title}.md`; if it does, update it with your changes
3. **Maintain the changelog**: Add a dated entry summarizing your changes
4. **Update the directory**: Add new specs to the table in [`.ai/specs/README.md`](.ai/specs/README.md)

This ensures design decisions are documented and the codebase remains well-understood by both humans and AI agents. See [`.ai/specs/README.md`](.ai/specs/README.md) for the full specification directory and [`.ai/specs/AGENTS.md`](.ai/specs/AGENTS.md) for detailed guidelines.

## Pull Requests

- Open PRs against `develop` unless you are coordinating a release hotfix.
- Describe the user impact, architectural notes, and testing performed (lint, unit, integration, CLI).
- Ensure the branch merges cleanly and CI is green before requesting review.
- Reference related issues or discussions; add screenshots or recordings for UI tweaks.
- Tag maintainers early if you need design or architectural guidance.

### Enterprise Module Contributions

> [!IMPORTANT]
> **We cannot accept external contributions to the enterprise module.**

The `@open-mercato/enterprise` package (`packages/enterprise/`) is commercial,
proprietary software governed by its own [license](packages/enterprise/LICENSE.md) — not
the open-source terms that cover the rest of this repository. Because of the licensing and
intellectual-property / IP-transfer constraints around that package, **we are unable to
review, accept, or merge pull requests that modify anything under `packages/enterprise/`**,
even when they are otherwise high quality.

What this means in practice:

- Do not open PRs that add to, modify, refactor, or reverse-engineer files under
  `packages/enterprise/`. They will be closed without merge.
- The Contributor License Agreement (see [`apps/docs/cla.md`](apps/docs/cla.md)) governs
  contributions to the open-source projects only; it does not grant rights to the
  commercial enterprise codebase, so it cannot be used to upstream enterprise changes.
- If you have found a bug in an enterprise module, please report it through your
  commercial support channel or open an issue describing the problem (without proposing a
  code change to the package).
- If you want to build or extend enterprise functionality, reach out about the
  [Open Mercato Partnership Program](packages/enterprise/README.md) and commercial
  licensing instead.

Contributions to every other package and app in this repository are welcome — only the
`packages/enterprise/` tree is off-limits.

### Package Previews

PRs do not publish npm canary packages automatically. Maintainers can publish pkg.pr.new package previews for a PR by dispatching the `Package Previews` workflow manually with the PR number — run it from the Actions tab, with `gh workflow run package-previews.yml --ref develop -f pr_number=<PR>`, or via the `om-auto-publish-pr` skill. To publish a fresh preview after more commits, re-run the dispatch with the same PR number.

The legacy npm canary snapshot path is still available for comparison by dispatching the `NPM Snapshot Preview` workflow manually with the PR number on a trusted same-repository PR branch. That workflow publishes real npm canary packages and runs standalone app integration against the exact snapshot, so use it only when pkg.pr.new previews are not enough evidence. Both preview workflows are restricted to same-repository PR branches.

## Helpful Resources

- 📚 Documentation: [docs.openmercato.com](https://docs.openmercato.com/)
- 🧠 Agents & architecture guide: [`AGENTS.md`](AGENTS.md)
- 💬 Community discussions and issues: [GitHub issues](https://github.com/open-mercato/open-mercato/issues)

Thanks for helping us build a more extensible, AI-ready operations platform!
