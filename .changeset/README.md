# Changesets

This repository uses [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

## For Contributors

When you make changes that should result in a new version of one or more packages, you need to add a changeset:

```bash
yarn changeset
```

This will prompt you to:

1. Select which packages have been changed
2. Choose the type of version bump (major, minor, patch)
3. Write a summary of your changes

The changeset will be saved as a markdown file in the `.changeset` directory. Commit this file along with your changes.

## Version Types

- **patch**: Bug fixes and minor updates (e.g., `0.4.1` -> `0.4.2`)
- **minor**: New features that are backwards compatible (e.g., `0.4.1` -> `0.5.0`)
- **major**: Breaking changes (e.g., `0.4.1` -> `1.0.0`)

## Release Process

### Canary/Snapshot Releases

Canary releases are automatically published when:
- Code is pushed to the `develop` branch
- A PR is opened targeting `main` or `develop`

These releases are tagged as `@canary` on npm and have versions like `0.4.1-canary-20250122-abc1234`.

To install a canary version:

```bash
npm install @open-mercato/shared@canary
```

### Stable Releases

When changesets are merged to `main`:

1. A "Release" PR is automatically created/updated
2. This PR includes version bumps and changelog updates
3. When the Release PR is merged, packages are published to npm with the `@latest` tag

## Commands

```bash
# Add a new changeset
yarn changeset

# Preview version changes (dry run)
yarn changeset:version

# Publish packages (usually done by CI)
yarn changeset:publish
```

## Notes

- The `apps/` packages are marked as private and won't be published
- Only packages in `packages/` with `"private": false` (or no private field) are published
- Each package maintains its own version independently
