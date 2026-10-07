/**
 * Public embed loader — GET /api/forms/public/embed-loader
 *
 * Serves a tiny, framework-free ES5 IIFE that a third-party site drops in via
 * `<script src=".../api/forms/public/embed-loader"></script>`. The loader:
 *   - finds every `[data-om-form="SLUG"]` placeholder element,
 *   - reads its OWN script origin (the OM app origin it loaded from),
 *   - injects an `<iframe src="<origin>/embed/SLUG">`,
 *   - listens for `message` events and accepts ONLY messages whose
 *     `event.origin` equals the script origin AND whose `type` starts with
 *     `om-forms:` (R-RS-4),
 *   - resizes the matching iframe on `om-forms:resize` — debounced via
 *     `requestAnimationFrame` and clamped to a max height (R-RS-5).
 *
 * Unauthenticated by design (the script is public). No secrets, no PII.
 * Spec: `2026-05-21-forms-render-surfaces.md` (S4 / D4).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: false },
}

const MAX_IFRAME_HEIGHT = 20000
const MIN_IFRAME_HEIGHT = 150

const LOADER_SCRIPT = `(function () {
  "use strict";
  var current = document.currentScript;
  if (!current || !current.src) return;
  var origin;
  try { origin = new URL(current.src).origin; } catch (e) { return; }

  var MAX_HEIGHT = ${MAX_IFRAME_HEIGHT};
  var MIN_HEIGHT = ${MIN_IFRAME_HEIGHT};
  var TYPE_PREFIX = "om-forms:";
  var frames = {};

  function clamp(value) {
    if (typeof value !== "number" || isNaN(value)) return MIN_HEIGHT;
    if (value < MIN_HEIGHT) return MIN_HEIGHT;
    if (value > MAX_HEIGHT) return MAX_HEIGHT;
    return Math.ceil(value);
  }

  function mount(el) {
    if (el.getAttribute("data-om-form-mounted") === "1") return;
    var slug = el.getAttribute("data-om-form");
    if (!slug) return;
    el.setAttribute("data-om-form-mounted", "1");

    var iframe = document.createElement("iframe");
    iframe.src = origin + "/embed/" + encodeURIComponent(slug);
    iframe.title = el.getAttribute("data-om-form-title") || "Form";
    iframe.setAttribute("loading", "lazy");
    iframe.style.width = "100%";
    iframe.style.border = "0";
    iframe.style.height = MIN_HEIGHT + "px";
    iframe.style.display = "block";
    el.appendChild(iframe);
    frames[slug] = iframe;
  }

  function mountAll() {
    var nodes = document.querySelectorAll("[data-om-form]");
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  var pending = null;
  function onMessage(event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || typeof data.type !== "string") return;
    if (data.type.indexOf(TYPE_PREFIX) !== 0) return;
    if (data.type !== TYPE_PREFIX + "resize") return;
    if (event.source == null) return;

    var target = null;
    for (var slug in frames) {
      if (frames.hasOwnProperty(slug) && frames[slug].contentWindow === event.source) {
        target = frames[slug];
        break;
      }
    }
    if (!target) return;

    var height = clamp(data.height);
    if (pending) return;
    pending = (window.requestAnimationFrame || window.setTimeout)(function () {
      pending = null;
      target.style.height = height + "px";
    }, 16);
  }

  window.addEventListener("message", onMessage, false);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll, false);
  } else {
    mountAll();
  }
})();
`

export async function GET() {
  return new NextResponse(LOADER_SCRIPT, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  })
}

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Serve the external embed loader script',
  description:
    'Returns a framework-free JS loader that injects an iframe per [data-om-form] element pointing at /embed/:slug and wires postMessage auto-resize.',
  tags: ['Forms Public Runtime'],
  responses: [
    {
      status: 200,
      description: 'The embed loader script (application/javascript)',
      schema: z.string(),
    },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Forms external embed loader script',
  methods: { GET: getMethodDoc },
}
