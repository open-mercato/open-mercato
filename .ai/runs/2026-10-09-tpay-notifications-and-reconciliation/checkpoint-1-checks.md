# Checkpoint 1 — steps 1.1..1.4

- **Timestamp:** 2026-10-09T18:06:12Z
- **Steps:** 1.1–1.4 (`dcab00283`..`50d4d0c76`)
- **Areas:** `gateway_tpay` notification parsing, MD5, JWS + certificates, handler, formatter, registration; user guide; notification spec

| Check | Result |
|-------|--------|
| `yarn workspace @open-mercato/gateway-tpay typecheck` | ✅ |
| `yarn workspace @open-mercato/gateway-tpay test` | ✅ 260/260 |
| `npx eslint packages/gateway-tpay/src` | ✅ (1 pre-existing warning in `cli.ts`) |
| `yarn i18n:check-sync` | ✅ |
| core `payment_gateways` Jest | ✅ 180/180 |
| UI verification | ⏭️ no UI files |
