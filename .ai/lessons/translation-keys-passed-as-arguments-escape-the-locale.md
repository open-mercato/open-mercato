---
title: "Translation keys passed as arguments escape the locale-coverage guard"
modules: ["incidents"]
areas: ["testing","backend-ui"]
topics: ["i18n","locale-coverage","testing"]
---

# Translation keys passed as arguments escape the locale-coverage guard

**Context**: New incident strings shipped untranslated even though the i18n coverage guard was green. The guard only recognizes literal `t('key')` / `translate('key')` call sites; the missing keys reached the translator indirectly, as a `fallbackKey` parameter passed into a shared component.

**Problem**: A key that is never written inside a `t(...)` call is invisible to the guard, so an incomplete locale file still passes. The gap widens with every helper that accepts a key as an argument.

**Rule**: When adding locale keys, grep for new `'<module>.…'` string literals as well as `t(...)` call sites. Any key handed to a helper as an argument must be added to the locale files by hand — the guard will not catch it.

**Applies to**: Adding module locale keys, shared components that accept key parameters, and reviewing `yarn i18n:check-*` results.
