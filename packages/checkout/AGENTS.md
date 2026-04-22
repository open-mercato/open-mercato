# Checkout Package — Agent Guidelines

Use `packages/checkout/src/modules/checkout/` for all checkout module work.

## MUST Rules

1. MUST keep checkout isolated from core business modules; use DI, events, and UMES surfaces instead of direct module internals.
2. MUST treat public pay-page security as server-authoritative. Never trust submitted amount, status, or consent state from the client.
3. MUST store checkout customer PII through the platform encryption pipeline and gate admin PII exposure behind `checkout.viewPii`.
4. MUST keep pay-page replacement handles and UMES spot IDs stable once released.
5. MUST follow the pay-links Phase A spec and its companion wireframes before changing checkout UI or API behavior.

## Reference Files

- Spec: `.ai/specs/2026-03-19-checkout-pay-links.md`
- UI wireframes: `.ai/specs/2026-03-19-checkout-pay-links-wireframes.md`
- Core module guidance: `packages/core/AGENTS.md`
- UI guidance: `packages/ui/AGENTS.md`

## Structure

- `src/modules/checkout/` — checkout module root
- `src/modules/checkout/data/` — entities and validators
- `src/modules/checkout/commands/` — admin and internal commands
- `src/modules/checkout/api/` — admin and public API routes
- `src/modules/checkout/backend/` — admin pages
- `src/modules/checkout/frontend/` — public pay pages
- `src/modules/checkout/widgets/` — UMES injections and replacement-aware components

## Security Notes

- Public routes must never expose gateway credentials, gateway settings, password hashes, or prior-customer data.
- Password verification must remain slug-bound and cookie-backed.
- Checkout transaction status updates must be idempotent because gateway events and status polling can race.
- The public submit endpoint validates Origin/Referer headers against allowed origins. Extra origins can be added via `CHECKOUT_ALLOWED_ORIGINS` (comma-separated) for cross-domain pay pages.
- Idempotency-Key must be 16–128 characters to prevent trivially guessable keys.
