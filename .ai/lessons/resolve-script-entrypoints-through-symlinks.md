---
title: "Resolve script entrypoints through symlinks"
modules: ["starter","create_app"]
areas: ["debugging","testing"]
topics: ["symlinks","script-entrypoints","encryption","setup"]
---

# Resolve script entrypoints through symlinks

**Context**: Disposable PostgreSQL QA of #8913 returned a successful setup exit and seed marker while its guarded mutation never ran. The helper compared `path.resolve(process.argv[1])` with `fileURLToPath(import.meta.url)`. Node canonicalizes module paths, but argv can retain a symlink such as macOS `/tmp` pointing to `/private/tmp`, so both executable branches were skipped.

**Rule**: Compare canonical filesystem paths when distinguishing an imported module from an executable script. Treat absent or inaccessible argv paths as an import, and preserve command exit statuses. Keep mirrored starter and standalone helpers identical.

**Verification**: Invoke every executable mode through an explicit linked directory. Assert the failure status and refusal text for invalid configuration, and prove a permitted guarded command actually ran; exit zero or a seed marker alone is insufficient. Include the linked installed-script layout in disposable database tests.
