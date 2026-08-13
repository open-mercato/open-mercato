---
title: "Universal documentation UI must be verified across the generated site"
modules: ["docs"]
areas: ["testing","debugging"]
topics: ["build-output","ui-components","regression-testing"]
---

# Universal documentation UI must be verified across the generated site

**Context**: A copy control intended for every Docusaurus documentation page was mounted through `DocItem/TOC`. Pages without an h2/h3 never render that theme component, so five generated pages omitted the control even though representative desktop and mobile pages worked.

**Rule**: For a UI feature promised on every generated document, write an artifact-level regression test first: build the site, identify every generated documentation page, and assert the control's stable marker on each page. Mount the control in an unconditional documentation subtree, not in an optional theme component such as a TOC, paginator, or sidebar.

**Applies to**: Docusaurus swizzles, static-site features, SSR/SSG UI, and any requirement expressed as "every page" or "all generated artifacts".
