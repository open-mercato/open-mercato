---
title: "Jest must transform transitive ESM sanitizer dependencies"
modules: ["sync_shopify"]
areas: ["testing"]
topics: ["jest","esm","package-runtime"]
---

# Jest must transform transitive ESM sanitizer dependencies

**Context**: Shopify's adapter tests imported the shared DI container, which loaded the rich-text sanitizer and its nested `htmlparser2` dependency. A cold CI run failed before executing tests because that dependency contains ESM imports and Shopify's Jest configuration ignored it.

**Rule**: When an import chain reaches ESM dependencies, keep the package's JavaScript transformer enabled and align its `transformIgnorePatterns` allowlist with established packages. For the sanitizer chain this includes `sanitize-html`, `htmlparser2`, `domhandler`, `domutils`, `dom-serializer`, `domelementtype`, and `entities`. Transforming the real implementation preserves behavior; mocking the sanitizer merely to make imports work can conceal sanitizer regressions. Verify after installing the lockfile dependencies and with `--no-cache`, rather than relying on a previous warm local pass.

**Evidence**: A cold `adapter.test.ts` run reproduced `Cannot use import statement outside a module` in nested `htmlparser2`. After aligning the transform allowlist, all seven Shopify suites and 34 tests passed without cache.

**Applies to**: package Jest configurations whose source imports reach shared DI or rich-text sanitization.
