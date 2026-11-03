export const EDITOR_PRESENCE_STYLES = `
.om-doc-collab .collaboration-carets__caret {
  position: relative;
  margin-left: -1px;
  margin-right: -1px;
  border-left-width: 2px;
  border-left-style: solid;
  border-right-width: 0;
  box-sizing: border-box;
  cursor: help;
  pointer-events: auto;
}
.om-doc-collab .collaboration-carets__caret::before {
  position: absolute;
  top: -0.4em;
  bottom: -0.4em;
  left: -7px;
  width: 14px;
  content: '';
}
.om-doc-collab .collaboration-carets__label {
  position: absolute;
  top: -1.55em;
  left: -2px;
  max-width: 180px;
  overflow: hidden;
  border-radius: var(--radius-sm, 0.25rem);
  padding: 1px 6px;
  color: var(--primary-foreground);
  font-size: var(--font-size-overline);
  font-weight: 600;
  line-height: var(--font-size-overline--line-height);
  opacity: 0;
  pointer-events: none;
  text-overflow: ellipsis;
  user-select: none;
  white-space: nowrap;
  animation: om-doc-caret-flag 2.6s ease forwards;
}
.om-doc-collab .collaboration-carets__caret:hover .collaboration-carets__label,
.om-doc-collab .collaboration-carets__caret:focus .collaboration-carets__label,
.om-doc-collab .collaboration-carets__caret:focus-visible .collaboration-carets__label {
  animation: none;
  opacity: 1;
}
.om-doc-collab .collaboration-carets__caret:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.om-doc-preview .collaboration-carets__caret,
.om-doc-preview .ProseMirror-yjs-selection {
  display: none;
}
.ProseMirror .om-entity-ref {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  border: 1px solid color-mix(in oklab, var(--primary) 24%, transparent);
  border-radius: var(--radius-sm, 0.25rem);
  background: color-mix(in oklab, var(--primary) 12%, transparent);
  color: var(--primary);
  cursor: default;
  font-weight: 500;
  line-height: 1.6;
  padding: 0 0.375em;
  vertical-align: baseline;
  white-space: nowrap;
}
@keyframes om-doc-caret-flag {
  0% { opacity: 0; transform: translateY(3px); }
  8%, 52% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .om-doc-collab .collaboration-carets__label { animation: none; opacity: 1; }
}
`
