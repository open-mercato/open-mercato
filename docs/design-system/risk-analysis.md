# H. Migration Risk Analysis

> 6 migration risks with mitigations + probability x impact matrix.

---

## Risk 1: Breaking changes in Alert/Notice unification

| | |
|---|---|
| **Description** | 7 files import Notice, 2 import ErrorNotice. The API change requires editing these files. Contributors may have open PRs using Notice. |
| **Probability** | Low — Notice is used in 9 files, not widely adopted |
| **Impact** | Low — migration is mechanical, 1:1 prop mapping |
| **Mitigation** | 1. Deprecation warning in Notice (do not remove immediately). 2. Notice wrapper internally delegates to Alert (backward compatible). 3. Migration guide in PR description. 4. 2 minor releases with deprecation before removal. |
| **Rollback** | Restore Notice.tsx — git revert. Zero data loss, zero runtime risk. |

## Risk 2: Semantic tokens with poor contrast in dark mode

| | |
|---|---|
| **Description** | OKLCH colors are difficult to manually verify for contrast. New semantic tokens may have insufficient contrast in dark mode. |
| **Probability** | Low (after flat tokens decision) — each status has dedicated light/dark values. The risk primarily concerns choosing correct OKLCH lightness values. |
| **Impact** | High — unreadable alerts/badges in dark mode |
| **Mitigation** | 1. Flat tokens eliminate the main risk (each mode has dedicated values). 2. Test EVERY token in Chrome DevTools Color Contrast checker. 3. axe-core automated scan in Playwright. 4. Screenshot comparison light vs dark for each component before merge. |
| **Rollback** | Change CSS custom properties — immediate, zero code to revert. |

**Applied solution:** Flat tokens with dedicated per-mode values (section I). Opacity-based approach rejected at the design stage — see section 3.1 "Architectural decision".

## Risk 3: 372 color migrations — visual regression

| | |
|---|---|
| **Description** | Replacing 372 hardcoded colors with semantic tokens may cause unexpected visual changes. Different shades (red-500 vs red-600 vs red-700) are replaced with a single token. |
| **Probability** | Medium — most replacements are 1:1, but nuances (e.g., red-800 used intentionally as a darker variant) may be lost |
| **Impact** | Medium — visual changes, not functional |
| **Mitigation** | 1. Per-module migration (not an atomic PR) — easier to review. 2. Screenshot before/after for each PR. 3. Reviewer must confirm visual correctness. 4. For nuances (intentional use of red-800): add comment `/* intentional: darker shade for X */` and use a token with modifier (e.g., `text-status-error dark:text-status-error-emphasis`). |
| **Rollback** | Git revert per-module PR. |

**Visual regression tools:**
- Playwright screenshot comparison (already in the stack)
- Manual review in PR (screenshot before/after as attachment)
- Optionally: Chromatic / Percy for automated visual diff (cost)

## Risk 4: External contributor confusion

| | |
|---|---|
| **Description** | Contributors with open PRs may be using the old API (Notice, hardcoded colors). After merging DS changes, their PRs will have conflicts or lint errors. |
| **Probability** | Medium — depends on the number of active PRs |
| **Impact** | Medium — contributor frustration, longer merge time |
| **Mitigation** | 1. **Changelog entry** in the PR with DS changes — clear description of what changed. 2. **Migration guide** in `MIGRATION.md` or a section in AGENTS.md. 3. **Deprecation warnings** (not hard breaks) for 2 minor versions. 4. **GitHub Discussion / Issue** announcing DS changes before the hackathon. 5. Lint rules as `warn` (not `error`) for the first sprint. |
| **Rollback** | N/A — this is a communication risk, not technical. |

## Risk 5: CrudForm coupling

| | |
|---|---|
| **Description** | FormField wrapper and CrudForm FieldControl do similar things (label + input + error). Risk of logic diverging over time. |
| **Probability** | Low — FormField is a simple wrapper (zero validation logic), CrudForm FieldControl is complex (loadOptions, field types, validation triggers) |
| **Impact** | Medium — inconsistent form styling between CrudForm and standalone forms |
| **Mitigation** | 1. FormField **does NOT duplicate** CrudForm logic — it is a pure layout wrapper. 2. CrudForm retains its own FieldControl. 3. Shared elements (label style, error style) extracted to **shared CSS classes** or **shared sub-components** (e.g., `FieldLabel`, `FieldError`). 4. Long-term (v1.0): CrudForm may be refactored to use FormField internally. |
| **Rollback** | N/A — FormField is additive, does not change CrudForm. |

**Target architecture:**

```
FormField (layout wrapper)
  ├── FieldLabel (shared)
  ├── {children} (input slot)
  ├── FieldDescription (shared)
  └── FieldError (shared)

CrudForm FieldControl (logic wrapper)
  ├── FieldLabel (shared)       ← same sub-components
  ├── {field type renderer}
  ├── FieldDescription (shared) ← same sub-components
  └── FieldError (shared)       ← same sub-components
```

## Risk 6: Performance — large components

| | |
|---|---|
| **Description** | AppShell (1650 lines), CrudForm (1800 lines), DataTable (1000+ lines). DS refactors (e.g., changing colors, adding tokens) in these files may affect render performance. |
| **Probability** | Low — changes are CSS-only (Tailwind classes), not render logic |
| **Impact** | Low — Tailwind classes are resolved at build time, not runtime |
| **Mitigation** | 1. The DS hackathon **does NOT refactor** AppShell/CrudForm/DataTable — only changes CSS classes. 2. Larger refactors (e.g., SectionHeader extraction from CrudForm) deferred to phase 2 with a performance benchmark. 3. React DevTools Profiler before and after changes. 4. `React.memo` already used on FieldControl — keep it. |
| **Rollback** | CSS class changes are trivial to revert. |

---

## Risk Matrix — Summary

| Risk | Probability | Impact | Overall | Mitigation priority |
|------|-------------|--------|---------|---------------------|
| R1: Alert/Notice breaking | Low | Low | **Low** | Deprecation path |
| R2: Dark mode contrast | Low (flat tokens) | High | **Medium** | Test every token |
| R3: Visual regression | Medium | Medium | **Medium** | Per-module PR + screenshots |
| R4: Contributor confusion | Medium | Medium | **Medium** | Communication plan |
| R5: CrudForm coupling | Low | Medium | **Low** | Shared sub-components |
| R6: Performance | Low | Low | **Low** | CSS-only changes |

**Top risk requiring immediate action:** R3 (visual regression during 372 color migrations) — per-module PRs with screenshots before/after. R2 mitigated by flat tokens, but contrast verification in Chrome DevTools is still mandatory.

---

---

---

## See also

- [Enforcement](./enforcement.md) — migration plan with mitigations
- [Executive Summary](./executive-summary.md) — risk summary
- [Migration Tables](./migration-tables.md) — color and typography migration details
