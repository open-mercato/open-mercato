---
title: "Validate downloaded design assets before integration"
modules: ["design_system"]
areas: ["testing","backend-ui"]
topics: ["figma","asset-integrity","downloads"]
---

# Validate downloaded design assets before integration

**Context**: Figma asset requests returned HTTP 202 with empty bodies. The files existed, so source imports and mocked-image component tests passed, but the application build failed on an SVG without a root element.

**Rule**: Before integrating downloaded artwork, validate actual bytes rather than file existence or HTTP success alone. Parse SVG roots and check PNG signatures, dimensions, chunk boundaries, and compressed image data. Keep a source-asset integrity test because image module mocks do not exercise the bundler's asset loader. Stop at access challenges and use an authorized connector export or verified existing original bytes; never save challenge responses as assets.

**Applies to**: Figma exports and other remotely supplied image assets used by the native design-system gallery.
