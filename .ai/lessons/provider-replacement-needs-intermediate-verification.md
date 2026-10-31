---
title: "Provider replacement needs intermediate verification while the old package remains installed"
modules: ["cli", "create_app"]
areas: ["architecture", "framework-context", "testing"]
topics: ["module-identity", "package-runtime", "generated-files", "provider-replacement", "registration-preflight"]
---

# Provider replacement needs intermediate verification while the old package remains installed

**Context**: Origin-qualified module requirements and manually authored imports can continue to refer to a provider after its discovery registration is disabled.

**Problem**: A disable, replace, enable, regenerate sequence removes the old package before proving that its dependants and imports have been reconfigured. Replacement guidance can therefore omit a required safe intermediate state even when it mentions final verification.

**Rule**: Disable every consumer of the binding, resolve or reconfigure old-origin dependants and manual imports, and successfully regenerate and build while the old package remains installed. Only then replace the binding, enable the intended provider, and regenerate and build again. Guidance regressions must verify both ordered verification stages. Validate active source registrations before a runtime resolver deduplicates them: installation and generators must reject repeated IDs before any source or generated-output write, even when runtime loading intentionally keeps the first registration. Test with the real deduplicating resolver and an existing output sentinel.

**Applies to**: Standalone module installation documentation, the routed module-tool guide, and provider replacement coverage in the standalone harness.
