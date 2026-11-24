---
title: "Measure selection and surface contrast in component previews"
modules: ["design_system"]
areas: ["testing"]
topics: ["contrast","component-previews","theme-isolation"]
---

# Measure selection and surface contrast in component previews

The graphite showcase passed its text contrast checks while its selected segment had only 1.08:1 contrast with the surrounding track in light mode.

Inspect the rendered preview in both modes. Compare the selected fill with the track, the input outline with the field, and the example card with its surrounding surface. Measure text against the background actually painted beneath it.

The catalogue once applied its graphite theme to both documentation and specimens. Compare computed surface, ink, accent and shape tokens on a real specimen with the corresponding DS theme. Check inline and isolated previews in each mode, and measure the documentation shell separately.
