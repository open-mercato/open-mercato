# Annotated Source Library

The verified sources behind the evidence hierarchy. Cite these — and only these classes of sources — when tagging findings [STANDARD]/[PLATFORM]/[RESEARCH]/[HEURISTIC]. Never invent a citation; a claim with no source from this library (or product data) is an [ASSUMPTION].

## Standards ([STANDARD])

- **WCAG 2.2** — https://www.w3.org/WAI/standards-guidelines/wcag/ (use the companion Understanding / How to Meet documents for interpretation). What's new in 2.2: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- **WAI-ARIA Authoring Practices Guide (APG)** — https://www.w3.org/WAI/ARIA/apg/ — the reference for custom-control semantics and keyboard contracts. **Caveat: misapplied ARIA is worse than no ARIA** — native HTML elements first; reach for ARIA only when no native element fits, and then follow the APG pattern exactly.
- **ISO 9241-210** (human-centred design for interactive systems) — https://www.iso.org/standard/77520.html — the process standard behind "involve users, iterate, evaluate against requirements".

## Platform conventions ([PLATFORM])

- **Material 3 foundations** — https://m3.material.io/foundations
- **Apple Human Interface Guidelines** — https://developer.apple.com/design/human-interface-guidelines
- Standard web browser behaviors (back button, links, scroll, native form semantics) are platform evidence for web products — no single URL; cite the behavior itself.

## Verified pattern libraries ([RESEARCH])

- **GOV.UK Design System** — https://design-system.service.gov.uk/ — research-backed patterns with published rationale. Key patterns: validation and error summaries https://design-system.service.gov.uk/patterns/validation/; user research method guidance in the Service Manual https://www.gov.uk/service-manual/user-research; content design https://www.gov.uk/guidance/content-design
- **Baymard Institute** — https://baymard.com/ — large-scale usability research on checkout, search, and product lists. **Caveat: e-commerce-specific** — findings come from consumer commerce contexts; do not transplant them blindly into a backoffice or other domains without re-checking the context.
- **Nielsen Norman Group** — the ten usability heuristics https://www.nngroup.com/articles/ten-usability-heuristics/; user control and freedom https://www.nngroup.com/articles/user-control-and-freedom/
- **Microsoft Inclusive Design** — https://inclusive.microsoft.design/ — recognize exclusion; learn from diversity; solve for one, extend to many. Inclusive design is a *method*, accessibility is a *property* of the outcome.
- **Google PAIR Guidebook** — https://pair.withgoogle.com/guidebook/ — the People + AI patterns behind the AI-products module.

## Heuristics and process frames ([HEURISTIC])

- **Laws of UX** — https://lawsofux.com/ — **caveat: a memory aid, not sufficient evidence** — a named law cites the underlying psychology but does not prove the pattern fits your context; pair it with a stronger source or tag the claim honestly.
- **Double Diamond** — https://www.designcouncil.org.uk/resources/the-double-diamond/ — divergence/convergence process frame.
- **Google HEART framework** — https://research.google.com/pubs/archive/36299.pdf — Happiness, Engagement, Adoption, Retention, Task success; use it to pick success metrics (step 8 / response section 12).

## What is NOT in this library

Dribbble, Behance, Awwwards, and other visual-inspiration galleries. They may inspire aesthetics; they are never evidence for a UX decision — a screenshot carries no information about whether the design worked.
