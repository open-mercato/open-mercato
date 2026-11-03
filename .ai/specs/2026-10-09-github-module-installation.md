# GitHub Module Installation and npm Fallback

**Date:** 2026-10-09
**Status:** Draft — skeleton; Open Questions gate pending
**Scope:** OSS — `@open-mercato/cli`, `mercato module add`
**Related:** [Official Modules CLI Install and Eject](implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md)

## 📝 TLDR

Let developers install an Open Mercato module with a GitHub repository URL or an unscoped `owner/repo` shorthand, without spelling its npm package name, and select a specific release with `package@version`. Also let `module add` try GitHub when a scoped npm package definitively does not exist, explaining the source change before installation and reporting the installed package and module identity afterward. Reuse the package manager, existing module validation, registration, and generation flow.

## Open Questions

- **Q2:** When npm does not contain `@scope/name` and a same-name GitHub repository does not resolve, should the CLI prompt for another GitHub repository, or stop with an explicit-link retry instruction? npm scopes and GitHub owners can differ, as with `@piotrkarwatka/visits` and `pkarw/visits-example`; there is no deterministic name-only mapping between them.

### Resolved Scope

- **Q1 — user decision:** Keep both capabilities in one spec, delivered in separate phases.
- Each of the four input examples below must work as an individual invocation. This request does not add comma-separated or bulk installation.
- The normal interactive command must not require the developer to spell the npm identity for GitHub inputs or append `--allow-third-party`. Preserve explicit third-party trust through an interactive prompt; noninteractive behavior must remain explicit and compatible with existing consent flags.
- Normalize the exact repeated `https://github.com/` prefix in the fourth example to the intended GitHub repository and show the corrected URL. This is bounded repair of the requested GitHub input, not generic acceptance of malformed URLs or arbitrary hosts.
- **Versioning — user decision:** Accept an optional trailing `@version` for npm package names, GitHub `owner/repo` shorthand, and GitHub repository URLs. For scoped npm names, the leading `@` is the scope marker and the trailing `@` introduces the version.

## 📝 Problem Statement

Installing the visits example from GitHub currently requires a package-manager command that includes its npm identity, followed by `mercato module enable`. A repository link already identifies the source a developer wants, and the extra package-name syntax is unnecessary friction. A module that is absent from npm may nevertheless have a valid, published GitHub repository.

The request covers `module add`: `module enable` retains its existing role of registering an installed package. An unscoped shorthand means a complete `owner/repo`, not an owner alone.

## 📝 Proposed Solution

Proposed CLI examples:

```sh
yarn mercato module add @piotrkarwatka/visits
yarn mercato module add pkarw/visits-example
yarn mercato module add https://github.com/pkarw/visits-example
yarn mercato module add https://github.com/https://github.com/pkarw/visits-example.git
```

The scoped package input tries npm first; only a definitive package-not-found outcome is eligible for GitHub fallback. The other inputs select GitHub directly after normalization. Authentication, authorization, network, and package-installation errors must retain their own actionable errors rather than silently switching source. Preserve module eligibility checks, app registration, and explicit third-party consent; GitHub source selection must not gain official-package trust from an npm-looking name.

### Versioning Requirements

The same inputs accept `@version` to select an exact release, including prereleases:

```sh
yarn mercato module add @piotrkarwatka/visits@0.1.0
yarn mercato module add pkarw/visits-example@0.1.0
yarn mercato module add https://github.com/pkarw/visits-example@0.1.0
yarn mercato module add https://github.com/pkarw/visits-example.git@0.1.0
yarn mercato module add https://github.com/https://github.com/pkarw/visits-example.git@0.1.0
yarn mercato module add pkarw/visits-example@0.2.0-beta.1
```

- Preserve existing npm version and dist-tag behavior, including `@scope/name@version`; this addition must not confuse the scoped package marker with its version separator.
- For GitHub inputs, an exact semantic version selects a release tag named `<version>` or `v<version>`, not a branch or the default branch. If both tag spellings exist at different commits, fail with an ambiguity message rather than choosing different code silently. A matching tag is required; the examples describe accepted syntax, not a claim that the example repository already has these tags.
- Resolve the tag to a commit, verify that its package manifest declares the requested version, and let the package manager record the commit in the lockfile. Report the source, resolved version, and commit in the success message.
- Carry the requested version through npm-to-GitHub fallback, including when Q2 results in the user supplying a differently named repository. Never drop the selector or silently install a newer release. A missing npm version in an existing package is a version error, not evidence that the whole package is absent.
- Inputs without `@version` retain their source's ordinary default behavior: npm's default dist-tag or GitHub's default branch, with the resolved Git commit recorded in the lockfile.
- Reject an empty or malformed selector with examples of valid syntax. Unsupported GitHub version ranges and dist-tags must produce an actionable error; they must not become arbitrary Git refs. npm selector compatibility remains unchanged.
- Planned coverage must exercise scoped-name parsing, each GitHub input with a version, prereleases, missing and ambiguous tags, manifest-version mismatches, version-preserving fallback, and npm package-not-found versus version-not-found outcomes.

For the example repository, the installed package identity is `@piotrkarwatka/visits` and the module ID is `visits`, even though the repository is named `pkarw/visits-example`. Resolve these from validated package/module metadata rather than deriving them from the repository basename. The npm form succeeds from npm when that package is available; Q2 covers the mismatch case when it is not.

Example fallback message, subject to the Q2 decision:

```text
Package @example/visits was not found on npm.
Trying GitHub repository example/visits instead.
```

## 📋 Phasing

Use one spec with two phases: direct GitHub source resolution, input normalization, and exact `@version` selection, then scoped npm fallback that preserves the requested version. The final specification will include repository-root rules, package-name discovery, reference and lockfile behavior, compatibility, failures and recovery, self-contained integration coverage, and testable implementation steps. Detailed research and design remain pending Q2 under the interactive spec-writing gate.

## Changelog

- **2026-10-09:** Added the requested `package@version` syntax across npm and GitHub inputs, with exact release selection, prereleases, lockfile pinning, and version-preserving fallback requirements.
