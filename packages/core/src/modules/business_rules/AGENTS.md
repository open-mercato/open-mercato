# Business Rules — Agent Guidelines

Rule definitions, the rule engine (`lib/rule-engine.ts`, `lib/rule-evaluator.ts`, `lib/expression-evaluator.ts`) and the wildcard CRUD trigger (`subscribers/crud-rule-trigger.ts`). Change simulator contribution: `.ai/specs/2026-10-08-insights-change-simulator.md`.

## Always

- Keep production evaluation behaviour unchanged when adding options: `evaluatedAt` (evaluation context) and the trailing `at` of `findApplicableRules` / `isRuleEffective` default to "now"; `rule-clock.test.ts` pins it.
- Change an operator or the regex guard in `expression-evaluator.ts` together with `lib/simulation/tri-state-evaluator.ts`; the parity suite (`tri-state-evaluator.parity.test.ts`) must stay green.
- The rule backtest (`lib/simulation/rule-backtest.ts`, `insights.simulate.ts`) only evaluates: never call `executeRules`, the action executor, commands or event emitters from it (zero-side-effect test); bump `RULE_BACKTEST_VERSION` when its semantics change.
- Add `rule_execution_logs` indexes as concurrent, non-transactional migrations (drop-if-exists first) and mirror them in `data/entities.ts` and the snapshot.

## Validation

```bash
yarn workspace @open-mercato/core test -- src/modules/business_rules
OM_BUSINESS_RULES_SIM_PG_URL=<throwaway db url> npx jest --config jest.config.cjs --runInBand src/modules/business_rules/lib/simulation
```
