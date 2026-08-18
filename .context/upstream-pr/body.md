## Summary

`.gitignore` line 4 is `/**/node_modules/`. The **trailing slash restricts the pattern to directories**, so a symlink named `node_modules` — a file, mode `120000` — is not ignored, and git tracks it without complaint.

That is not hypothetical. Two such symlinks reached a branch in our fork, each pointing at an absolute path under a developer's home directory. They were caught in review and removed, but nothing prevented the commit, and nothing prevents the next one. Merged, they would break `packages/core` and `packages/ui` module resolution for every other checkout and for CI.

Dropping the slash makes the pattern match a directory *and* a file or symlink of that name.

## Changes

- `.gitignore` — `/**/node_modules/` → `/**/node_modules`, with a comment recording why the slash must not come back.

## Specification

**Does a spec exist for this feature/module?**
- [ ] Yes
- [ ] No (created a new spec)
- [x] N/A (minor change, no spec needed)

**Spec file path:**
n/a

## Testing

Verified by reproducing the gap on `develop` and confirming this change closes it.

Before — the symlink is not ignored, i.e. trackable:

```
$ git check-ignore -v packages/core/node_modules
  (no match)
$ git status --short
?? packages/core/node_modules
```

After — ignored, while real dependency directories still are:

```
$ git check-ignore -v packages/core/node_modules
.gitignore:7:/**/node_modules	packages/core/node_modules
$ git check-ignore -v node_modules
.gitignore:8:/node_modules	node_modules
```

Nothing already committed becomes invisible — no tracked path contains a `node_modules` segment:

```
$ git ls-files | grep -E "(^|/)node_modules($|/)"
  (no output)
```

## Checklist

- [x] This pull request targets `develop`.
- [ ] I have read and accept the Open Mercato Contributor License Agreement (see `docs/cla.md`). — left for the repository owner to confirm; see the note below.
- [ ] I updated documentation, locales, or generators if the change requires it. — none required: no user-facing string, generator input or schema is touched.
- [ ] I added or adjusted tests that cover the change. — `.gitignore` matching is git behaviour, not application code; there is no suite that exercises it. The verification above is the evidence, and it is reproducible in one command.
- [ ] I added or updated integration tests in `.ai/qa/tests/` (or documented why integration coverage is not required). — no runtime surface changes, so there is nothing to exercise.
- [ ] I created or updated the spec in `.ai/specs/` with a changelog entry (if applicable). — n/a.
- [ ] Priority set: this PR carries exactly one `priority-*` label. — this account has `read` here and cannot set labels; intent is in a follow-up comment.
- [ ] Risk set: this PR carries exactly one `risk-*` label describing its blast radius (`risk-low`/`risk-medium`/`risk-high`). — same.
- [ ] QA routing set. — same; `skip-qa` is the intent, rationale in the follow-up comment.

### Design System Compliance

Not applicable — this PR changes one line of `.gitignore` and touches no UI surface.

## Linked issues

None.
