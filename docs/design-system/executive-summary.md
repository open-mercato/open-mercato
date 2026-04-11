# A. Executive Summary

> Key takeaways, risks, quick wins, and recommended action plan.

---

## Key takeaways

1. **Open Mercato has solid UI foundations**: Tailwind v4, OKLCH color system, shadcn/ui primitives, CVA variants, Radix UI. The infrastructure is modern.

2. **The main problem is a missing semantic layer**: 372 hardcoded colors, 61 arbitrary text sizes, 4 different feedback components with different palettes. The system has base tokens but lacks a semantic layer.

3. **Patterns are good but not enforced**: CrudForm, DataTable, Page layout exist and work well. The problem is that 70% of pages do not use them or use them only partially.

4. **Duplication is natural for OSS**: 15+ Section components, Notice vs Alert, custom SVG vs lucide — this is a classic effect of multiple contributors without shared guidelines.

## Biggest risks

1. **Dark mode broken**: 372 hardcoded colors do not respond to dark mode — users see white text on white background or unreadable contrast
2. **Accessibility debt**: 370+ interactive elements without aria-label — potential legal risk (WCAG compliance)
3. **Scaling problem**: Without a design system every new module adds its own patterns — debt grows linearly with the number of modules

## Top quick wins

1. **Semantic color tokens** (CSS variables) — 1 day of work, eliminates 80% of the color problem
2. **Typography scale documentation** — half a day, eliminates "which size to use?"
3. **Alert unification** — 1 day, replaces 3 components with 1
4. **FormField wrapper** — half a day, new simple component
5. **Empty state enforcement** — documentation + PR review checklist

## Recommended action plan

```
Week 1 (hackathon):
  → Semantic color tokens
  → Typography scale
  → Alert unification
  → FormField wrapper
  → Status Badge
  → SectionHeader
  → Documentation

Week 2-3:
  → Icon standardization
  → Card unification
  → Spacing guidelines enforcement
  → Accessibility audit (aria-labels)

Week 4+:
  → Storybook setup
  → Migration of existing pages
  → Content style guide
  → Motion tokens
```

---

## See also

- [Audit](./audit.md) — full audit report
- [Hackathon Plan](./hackathon-plan.md) — detailed execution plan
- [Priority Table](./priority-table.md) — priority table
- [Risk Analysis](./risk-analysis.md) — migration risk analysis
