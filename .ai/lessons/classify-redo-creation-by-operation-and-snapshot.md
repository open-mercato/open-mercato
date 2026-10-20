---
title: "Classify redo creation by operation and snapshot"
modules: ["feature_toggles"]
areas: ["module-data","testing"]
topics: ["command-pattern","data-integrity","undo-redo"]
---

# Classify redo creation by operation and snapshot

While fixing #7665, review found that clearing an already inherited feature toggle produces the same null-ID before snapshot as creating an override. Treating every null-ID snapshot as creation made redo reject that valid no-op clear with HTTP 400.

Check both the operation intent and the snapshot when choosing snapshot-aware creation replay. Override creation requires `isOverride: true` and a null before ID; clear and update keep the existing execution path. Cover no-op mutations alongside create, update, and clear, and verify a second undo uses the fresh redo log version.
