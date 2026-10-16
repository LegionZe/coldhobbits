/**
 * Self-check scanner (owner's request 1.0.61): looks at a rendered window and lists display faults. DOM APIs only, no
 * Foundry imports, so it also runs in a plain browser page (the tests render the templates in Chromium and scan them).
 * Kinds:
 *  - rawKey: visible text (or a tooltip / placeholder / title) showing a language key such as "AD2E.Treasure.NoneYet"
 *    (1.0.59: a duplicate block in lang/en.json); tooltips count only when `hasKey` says the key is not defined (Foundry may
 *    localize a bare key in a tooltip).
 *  - placeholder: visible text with an unfilled "{name}" (a format string shown without its value; 1.0.59 "{gp}").
 *  - badValue: visible "undefined", "NaN" or "[object Object]".
 *  - squeezedInput: a visible text field or select narrower than 30px (the narrowest set on purpose is 3.5rem) (1.0.57: the Native language input in a 24px column).
 *  - spill: an element whose own text runs past its box (1.0.57: "Midani" over its note); the text ends with the box and
 *    content widths and the parent's grid columns (1.0.62, so a report shows the cause).
 *  - wrapped: two or more words in a box under 50px wide laid out on two or more lines (1.0.58: "Not rolled", "Spend (x 1,000
 *    gp)"); lines are counted from the text itself (1.0.62; the box height gave false findings in stretched rows).
 *  - overlap: two visible children of a grid or flex row covering each other.
 * Text inside <code> is not checked for keys, placeholders or bad values (1.0.66: literal examples, e.g. the GM manual
 * naming "undefined" among what this check finds).
 * Thresholds are implementation choices.
 */
export const SCAN_LIMITS = { inputMin: 30, wrapWidth: 50, overlapMin: 4, textMax: 200 };

const RAW_KEY = /\bAD2E\.[A-Z][A-Za-z0-9_.]*[A-Za-z0-9_]/;
const PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9_]*\}/;
const BAD_VALUE = /\b(undefined|NaN)\b|\[object Object\]/;

function visible(el) {
  if (!el || !el.getClientRects().length) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

/** A short description of where an element is: up to four ancestors below `root` (tag.class1.class2[data-tab|name]). */
export function elementPath(el, root) {
  const parts = [];
  for (let n = el; n && n !== root && parts.length < 4; n = n.parentElement) {
    let s = n.tagName.toLowerCase();
    const cls = [...n.classList].filter(c => !/^(active|draggable)$/.test(c)).slice(0, 2);
    if (cls.length) s += "." + cls.join(".");
    const tag = n.dataset?.tab ?? n.getAttribute?.("name") ?? n.dataset?.action;
    if (tag) s += `[${tag}]`;
    parts.unshift(s);
  }
  return parts.join(" > ");
}

const short = text => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > SCAN_LIMITS.textMax ? t.slice(0, SCAN_LIMITS.textMax - 1) + "…" : t;
};

/** Measurements for a layout finding: box and content width, and the parent's grid columns or flex setting. */
export function layoutNote(el) {
  const parent = el.parentElement;
  const pcs = parent ? getComputedStyle(parent) : null;
  const layout = !pcs ? "" : /grid/.test(pcs.display) ? `; parent grid ${pcs.gridTemplateColumns}`
    : /flex/.test(pcs.display) ? `; parent flex ${pcs.flexWrap}` : `; parent ${pcs.display}`;
  return `(box ${Math.round(el.clientWidth)}px, content ${Math.round(el.scrollWidth)}px${layout})`;
}

/**
 * Lines the element's own text is laid out on (distinct line tops of its text nodes). The box height is not used: a cell
 * or flex item is stretched to its row (1.0.61 report: "PM 1" and "Level 2" flagged though on one line).
 */
export function textLines(el) {
  const tops = new Set();
  const range = el.ownerDocument.createRange();
  for (const n of el.childNodes) {
    if (n.nodeType !== 3 || !n.textContent.trim()) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
  }
  return tops.size;
}

/** The element's own text (its direct text nodes). */
function ownText(el) {
  return [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(" ").replace(/\s+/g, " ").trim();
}

/** Scan a rendered element: [{ kind, text, path }]. `hasKey(key)` tells whether a language key is defined. */
export function scanElement(root, { hasKey = () => false } = {}) {
  const out = [];
  const seen = new Set();
  const add = (kind, el, text) => {
    const path = elementPath(el, root);
    const id = `${kind}|${path}|${text}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ kind, text: short(text), path });
  };
  if (!root) return out;
  // Text: raw keys, placeholders, bad values in visible text nodes.
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent;
    if (!text || !text.trim()) continue;
    const el = node.parentElement;
    if (!el || ["SCRIPT", "STYLE", "TEXTAREA", "OPTION", "CODE"].includes(el.tagName) || el.closest("code") || !visible(el)) continue;
    const raw = text.match(RAW_KEY);
    if (raw) add("rawKey", el, raw[0]);
    if (PLACEHOLDER.test(text)) add("placeholder", el, text);
    if (BAD_VALUE.test(text)) add("badValue", el, text);
  }
  // Selected options of visible selects (option text is not laid out on its own).
  for (const sel of root.querySelectorAll("select")) {
    if (!visible(sel)) continue;
    const text = sel.selectedOptions?.[0]?.textContent ?? "";
    const raw = text.match(RAW_KEY);
    if (raw) add("rawKey", sel, raw[0]);
    if (PLACEHOLDER.test(text)) add("placeholder", sel, text);
  }
  // Attributes: tooltips, placeholders, titles (raw keys only when undefined; placeholders always).
  for (const el of root.querySelectorAll("[data-tooltip], [placeholder], [title], [aria-label]")) {
    for (const attr of ["data-tooltip", "placeholder", "title", "aria-label"]) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      const raw = v.match(RAW_KEY);
      if (raw && !hasKey(raw[0])) add("rawKey", el, `${attr}: ${raw[0]}`);
      if (PLACEHOLDER.test(v) && !/^\{\{/.test(v)) add("placeholder", el, `${attr}: ${v}`);
    }
  }
  // Layout.
  for (const el of root.querySelectorAll("input, select, textarea")) {
    if (["checkbox", "radio", "hidden", "range", "color", "file", "image"].includes(el.type) || !visible(el)) continue;
    const w = el.getBoundingClientRect().width;
    if (w < SCAN_LIMITS.inputMin) add("squeezedInput", el, `${el.name || el.className || el.tagName.toLowerCase()} ${Math.round(w)}px`);
  }
  for (const el of root.querySelectorAll("span, label, a, strong, em, p, td, th, legend, div, h1, h2, h3, h4, li, dt, dd, button")) {
    if (!visible(el)) continue;
    const text = ownText(el);
    if (!text) continue;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const clipped = cs.overflowX !== "visible" || cs.textOverflow === "ellipsis";
    if (!clipped && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 4 && cs.display !== "inline") add("spill", el, `${text} ${layoutNote(el)}`);
    if (text.split(" ").length >= 2 && rect.width > 0 && rect.width < SCAN_LIMITS.wrapWidth && textLines(el) >= 2) {
      add("wrapped", el, `${text} (${Math.round(rect.width)}px wide, ${textLines(el)} lines)`);
    }
  }
  for (const box of root.querySelectorAll("*")) {
    const cs = getComputedStyle(box);
    if (!/grid|flex/.test(cs.display) || !visible(box)) continue;
    const kids = [...box.children].filter(visible).map(k => [k, k.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.height > 0);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const [a, ra] = kids[i], [b, rb] = kids[j];
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > SCAN_LIMITS.overlapMin && h > SCAN_LIMITS.overlapMin) add("overlap", a, `${short(a.textContent) || a.tagName.toLowerCase()} / ${short(b.textContent) || b.tagName.toLowerCase()}`);
    }
  }
  return out;
}
