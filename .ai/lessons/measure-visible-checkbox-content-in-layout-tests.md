---
title: "Measure visible checkbox content in layout tests"
modules: ["checkout", "ui"]
areas: ["testing", "backend-ui"]
topics: ["testing", "layout", "checkbox"]
---

# Measure visible checkbox content in layout tests

**Context**: The regression tests for checkout label overflow (#7750, PR #7755) passed in a standalone component harness but failed in the application form.

**Problem**: Radix Checkbox adds a visually hidden native input when mounted inside a form. A DOM Range covering the entire enclosing label includes that input's geometry, causing a false overflow failure even when the visible checkbox and translated text fit.

**Rule**: Assert the bounds of the visible checkbox and label text separately. Reproduce the actual form context in component browser harnesses so hidden form controls are present. Keep an original-revision overflow check to ensure the assertion still detects the reported defect.
