/**
 * Pure, framework-free HTML sanitiser + sandboxed-preview builder for the admin
 * announcements editor (see {@link AnnouncementEditorComponent}). Kept as a
 * standalone module (no Angular deps) so the dangerous-input logic is unit
 * testable in isolation and reusable by the iframe-`srcdoc` builder. It mirrors
 * the hugmesh-user-ui card-sanitize two-wall model.
 *
 * SECURITY MODEL — DEFENCE IN DEPTH. An announcement `body_html` is admin-authored
 * HTML that is shown to END USERS, including ANONYMOUS visitors on the public
 * login page. So it is sanitised on BOTH ends: the admin-api BFF sanitises it
 * server-side on create/update (the authority), and every surface that renders it
 * (this editor preview, the home banner, the login page, the forum page) draws it
 * inside a `<iframe sandbox>` that carries NEITHER `allow-scripts` NOR
 * `allow-same-origin`, so the framed document runs in a unique, opaque origin with
 * scripting disabled — it can neither execute JS nor reach the host DOM, cookies,
 * or storage. The functions below are the FIRST wall (so the preview matches what
 * the server will keep, and the source toggle shows clean HTML); the sandboxed
 * iframe is the SECOND, hard wall. A bypass of one layer is still contained by the
 * other. We NEVER use raw innerHTML.
 */

/** Block-level tags that may NEVER appear (active content / host escape). */
const FORBIDDEN_TAGS = new Set([
  'script',
  'style', // inline style blocks are not allowed; the host shell owns styling
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'svg', // SVG can host <script> / animatable href — drop wholesale
  'math',
]);

/**
 * Allow-list of tags kept in sanitised output. Anything not here is unwrapped
 * (its text/children survive, the tag is dropped) unless it is forbidden, in
 * which case the whole subtree is removed.
 */
const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'ul',
]);

/** Per-tag allow-list of attributes. Everything else (incl. on* + style) drops. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  '*': new Set(['class', 'id', 'title', 'lang', 'dir']),
};

/** URL schemes permitted on href/src. Everything else (javascript:, data: html…) drops. */
const SAFE_URL = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;
/** data: images are allowed (inert), but only image media types. */
const SAFE_DATA_IMG = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i;
/** Whitespace + C0 control chars an attacker smuggles into `java\nscript:`. */
const URL_NOISE = /[\u0000-\u0020]+/g;

function isSafeUrl(raw: string, isImg: boolean): boolean {
  const v = (raw ?? '').trim();
  const collapsed = v.replace(URL_NOISE, '').toLowerCase();
  if (collapsed.startsWith('javascript:') || collapsed.startsWith('vbscript:')) return false;
  if (isImg && SAFE_DATA_IMG.test(v)) return true;
  if (collapsed.startsWith('data:')) return false;
  return SAFE_URL.test(v);
}

/**
 * Sanitise an HTML fragment using the browser's own parser (DOMParser), so we
 * walk a real, normalised DOM tree rather than regex-matching strings. Returns
 * a string of allow-listed HTML with: forbidden subtrees removed,
 * non-allow-listed tags unwrapped, every `on*`/`style` attribute stripped,
 * href/src restricted to safe schemes, and `target=_blank` links hardened with
 * `rel="noopener noreferrer"`. Comments are dropped.
 */
export function sanitizeHtml(dirty: string): string {
  const doc = new DOMParser().parseFromString(`<body>${dirty ?? ''}</body>`, 'text/html');
  const body = doc.body;
  sanitizeNode(body);
  return body.innerHTML;
}

function sanitizeNode(node: Node): void {
  // Iterate over a static copy — we mutate childNodes as we go.
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.parentNode?.removeChild(child);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue; // keep text nodes

    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (FORBIDDEN_TAGS.has(tag)) {
      el.parentNode?.removeChild(el); // drop the WHOLE subtree
      continue;
    }

    // Recurse first so children are clean before we (maybe) unwrap this node.
    sanitizeNode(el);

    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(el); // keep the children, drop the unknown tag
      continue;
    }

    scrubAttributes(el, tag);
  }
}

function scrubAttributes(el: Element, tag: string): void {
  const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
  const global = ALLOWED_ATTRS['*'];
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const ok = allowed.has(name) || global.has(name);
    // on*-handlers and inline style are never allowed (host-style escape / JS).
    if (!ok || name.startsWith('on') || name === 'style') {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'href' && !isSafeUrl(attr.value, false)) {
      el.removeAttribute(attr.name);
    }
    if (name === 'src' && !isSafeUrl(attr.value, true)) {
      el.removeAttribute(attr.name);
    }
  }
  // Harden any link that opens a new tab so the opened page cannot reach
  // window.opener (reverse-tabnabbing).
  if (tag === 'a' && el.getAttribute('target') === '_blank') {
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/** Escape the five HTML-significant characters. */
export function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the full, self-contained document we drop into the sandboxed iframe's
 * `srcdoc` for the live preview. It contains ONLY: a tiny reset and the
 * sanitised announcement body inside `.announcement-root`. There is no
 * `<script>` anywhere and the iframe runs script-disabled in a null origin, so
 * this string can never act on the host. `title` is rendered as escaped text
 * (never markup) above the body so the admin sees the full announcement.
 */
export function buildPreviewDoc(title: string, bodyHtml: string): string {
  const safeBody = sanitizeHtml(bodyHtml);
  const safeTitle = escapeHtml(title ?? '').trim();
  const heading = safeTitle ? `<h2 class="announcement-title">${safeTitle}</h2>` : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; line-height: 1.5; }
  .announcement-root { padding: 1rem; }
  .announcement-title { margin-top: 0; }
  a { color: #7c4dff; }
  img { max-width: 100%; height: auto; }
</style></head>
<body><div class="announcement-root">${heading}${safeBody}</div></body></html>`;
}
