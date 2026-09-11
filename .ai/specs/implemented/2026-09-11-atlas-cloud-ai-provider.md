# Atlas Cloud AI Provider

## Status

Implemented.

## Context

The AI Assistant already registers OpenAI-compatible services from data-only presets. Atlas Cloud exposes the same protocol and can therefore use the existing adapter without a new runtime dependency or route.

## Decision

- Register `atlas-cloud` as an optional built-in provider.
- Read credentials from `ATLASCLOUD_API_KEY` and an optional endpoint override from `ATLASCLOUD_BASE_URL`.
- Use `https://api.atlascloud.ai/v1` as the default endpoint.
- Seed the catalog with `Qwen/Qwen3-235B-A22B-Instruct-2507`, whose live Atlas catalog entry supports tools and a 131072-token context window.
- Preserve the existing provider order and default-selection behavior; Atlas Cloud is selected only when configured or explicitly requested.

## Verification

Provider bootstrap and preset tests cover registration, credentials, endpoint resolution, and default model metadata without making network requests.
