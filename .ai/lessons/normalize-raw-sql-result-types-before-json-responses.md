---
title: "Normalize raw SQL result types before JSON responses"
modules: ["platform"]
areas: ["module-data"]
topics: ["testing","type-normalization"]
---

# Normalize raw SQL result types before JSON responses

**Context**: AI usage stats routes read PostgreSQL aggregate rows where `bigint` counters can arrive as JavaScript `bigint` values and timestamp/date expressions can arrive as strings instead of `Date` instances.

**Problem**: `NextResponse.json` cannot serialize `bigint`, and calling `toISOString()` directly on raw SQL timestamp fields crashes when the driver returns a string. These failures surface only with real database result shapes, not with entity-shaped mocks.

**Rule**: API routes that serialize raw SQL aggregate results must normalize every numeric and date field at the route boundary or in a shared serializer before returning JSON. Add route tests using driver-like `bigint` counters and string timestamps for every aggregate endpoint.

**Applies to**: Raw SQL report/stat endpoints, especially `count(*)::bigint`, `sum(...)::bigint`, `min(created_at)`, `max(created_at)`, and any route returning database aggregate rows through `NextResponse.json`.
