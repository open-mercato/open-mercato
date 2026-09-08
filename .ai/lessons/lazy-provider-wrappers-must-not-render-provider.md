---
title: "Lazy provider wrappers must not render provider-dependent children before the provider loads"
modules: ["ai_assistant","ui","cli"]
areas: ["integration","backend-ui","architecture"]
topics: ["provider-lifecycle","ui-components"]
---

# Lazy provider wrappers must not render provider-dependent children before the provider loads

**Context**: Backend chrome hydration moved the AI assistant header integration behind a client-only lazy wrapper that imported the provider component asynchronously.

**Problem**: The wrapper rendered `children` during the loading state, so provider-dependent descendants like `AiChatHeaderButton` mounted before `CommandPaletteProvider` existed and threw runtime context errors.

**Rule**: When a wrapper lazily imports a context provider or integration shell, render nothing or a provider-safe placeholder until the provider is ready. Never render children early if they may call hooks from that provider.

**Applies to**: Client-only integration shells, lazy provider wrappers, and any async-loaded context boundary in backend or portal chrome.
