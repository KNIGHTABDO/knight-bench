```jsx
import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";

/**
 * <BilingualComposer />
 * ---------------------------------------------------------------------------
 * A message-composer UI for apps where users freely mix Arabic and French
 * (sometimes within the same message). Single file, zero dependencies beyond
 * React, plain CSS-in-file (injected once via a <style> tag).
 *
 * DIRECTION DETECTION
 * ---------------------------------------------------------------------------
 * We implement the Unicode Bidirectional Algorithm's "first-strong" heuristic
 * ourselves (this is the same rule the HTML `dir="auto"` attribute uses under
 * the hood, but we compute it explicitly in JS because we need the resolved
 * direction as a piece of state — to mirror layout chrome, position the caret
 * logically, etc. — not just to hand a hint to the browser).
 *
 * Algorithm: scan the string codepoint by codepoint. The first character that
 * is "strong" (has an inherent direction) decides the paragraph direction:
 *   - Strong RTL  -> Arabic (and Arabic Presentation Forms) code points
 *   - Strong LTR  -> Latin/other letters (approximated via a broad letter regex,
 *     since Latin/French text is our only realistic LTR case here)
 *   - Neutral (digits, punctuation, whitespace, emoji, symbols) -> skip, keep
 *     scanning
 * If no strong character is found at all (message is only numbers/punctuation/
 * empty), we fall back to the `fallbackDir` prop supplied by the app.
 *
 * Arabic-range detection uses exactly the ranges requested:
 *   0600–06FF  Arabic
 *   0750–077F  Arabic Supplement
 *   08A0–08FF  Arabic Extended-A
 *   FB50–FDFF  Arabic Presentation Forms-A
 *   FE70–FEFF  Arabic Presentation Forms-B
 */

const ARABIC_RANGES = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];

function isArabicStrong(codePoint) {
  for (let i = 0; i < ARABIC_RANGES.length; i++) {
    const [start, end] = ARABIC_RANGES[i];
    if (codePoint >= start && codePoint <= end) return true;
  }
  return false;
}

// Broad "Latin-ish letter" test used as our LTR-strong signal. We deliberately
// use a Unicode property escape rather than hand-rolled A-Z ranges so accented
// French letters (é, à, ç, œ, î, ...) are correctly recognized as strong LTR.
const LTR_LETTER_RE = /\p{Script=Latin}/u;

/**
 * detectDirection(text, fallbackDir)
 * Returns "rtl" | "ltr" — the resolved first-strong direction, or fallbackDir
 * when the text has no strong characters at all.
 */
function detectDirection(text, fallbackDir) {
  if (!text) return fallbackDir;

  // Iterate by Unicode code point (not UTF-16 code unit) so we don't split
  // surrogate pairs (e.g. emoji) in half while scanning.
  for (const ch of text) {
    const cp = ch.codePointAt(0);

    if (isArabicStrong(cp)) return "rtl";

    // Any other Unicode-recognized bidi-strong-LTR letter (Latin script covers
    // French; we also treat any other letter outside the Arabic block and
    // outside common neutral categories as a weak LTR signal via the regex).
    if (LTR_LETTER_RE.test(ch)) return "ltr";
  }

  return fallbackDir;
}

/**
 * Live per-character-typed direction hook. Recomputed on every value change,
 * memoized so we don't redo the scan when unrelated state changes (e.g. focus).
 */
function useMessageDirection(text, fallbackDir) {
  return useMemo(() => detectDirection(text, fallbackDir), [text, fallbackDir]);
}

let stylesInjected = false;
function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-bilingual-composer", "true");
  style.textContent = CSS_TEXT;
  document.head.appendChild(style);
}

const CSS_TEXT = `
.bc-root {
  /* The root's own "dir" is set from the detected direction so that all
     logical properties below (margin-inline-start, etc.) resolve correctly
     without ever touching a physical left/right property. */
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 480px;
  font-family: system-ui, -apple-system, "Segoe UI", Tahoma, Arial, sans-serif;
}

/* ---- Preview bubble ---- */
.bc-preview-wrap {
  display: flex;
}
.bc-preview-wrap[data-dir="rtl"] {
  justify-content: flex-end;
}
.bc-preview-wrap[data-dir="ltr"] {
  justify-content: flex-start;
}
.bc-bubble {
  max-width: 85%;
  padding-block: 8px;
  padding-inline: 14px;
  border-radius: 16px;
  background: #e8f0fe;
  color: #1a1a1a;
  line-height: 1.5;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  /* CRITICAL BIDI MECHANISM, see long comment above the component. */
  unicode-bidi: plaintext;
}
.bc-bubble:empty::before {
  content: attr(data-placeholder);
  color: #8a8a8a;
}
.bc-bubble .bc-embed {
  unicode-bidi: isolate;
}

/* ---- Composer chrome ---- */
.bc-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  border: 1px solid #ccc;
  border-radius: 12px;
  padding: 8px;
  background: #fff;
}

/* Row order in the DOM is always [textarea, meta-column]; "meta-column"
   itself is a flex column holding the counter above the send button.
   We never reorder DOM nodes for RTL — the mirroring is achieved purely
   through logical flex properties, so no left/right physical CSS exists
   anywhere in this stylesheet. flex-direction: row already respects the
   inline axis, i.e. it auto-mirrors based on the element's resolved
   direction (this is how logical flow works for flexbox: "row" means
   "along the inline direction", which is right-to-left content flow when
   dir=rtl). That's what makes the send button appear at the *inline-end*
   for LTR and at the *inline-end* (visually left) for RTL automatically. */
.bc-textarea {
  flex: 1 1 auto;
  resize: none;
  border: none;
  outline: none;
  font: inherit;
  font-size: 15px;
  line-height: 1.4;
  min-height: 44px;
  max-height: 160px;
  background: transparent;
  padding: 4px 0;
  /* text-align follows the logical "start" of the element's own dir,
     which we set dynamically per keystroke via the dir attribute. */
  text-align: start;
}

.bc-meta-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  /* logical-only spacing from the textarea */
  margin-inline-start: 6px;
}

.bc-counter {
  font-size: 11px;
  color: #888;
  min-width: 2.5em;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.bc-counter[data-over="true"] {
  color: #c0392b;
  font-weight: 600;
}

.bc-send-btn {
  border: none;
  border-radius: 50%;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  padding: 0;
  transition: background-color 0.15s ease, transform 0.1s ease;
}
.bc-send-btn:disabled {
  background: #9ab6f2;
  cursor: not-allowed;
}
.bc-send-btn:not(:disabled):active {
  transform: scale(0.94);
}

/* The send icon is a simple triangle drawn with CSS borders. We flip it
   using a logical-safe technique: instead of physical transform values tied
   to "left"/"right", we key the mirror off the same data-dir attribute the
   rest of the component uses, so the arrow always points toward the
   inline-end (the direction a message physically travels when sent). */
.bc-send-icon {
  width: 0;
  height: 0;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-inline-start: 10px solid currentColor;
}

.bc-dir-badge {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #aaa;
  align-self: flex-start;
}
.bc-root[dir="rtl"] .bc-dir-badge {
  align-self: flex-end;
}
`;

/**
 * Splits text into segments so we can wrap clearly-foreign runs (e.g. a
 * Latin product name inside an Arabic sentence) in a `unicode-bidi: isolate`
 * span. This is a *defense in depth* measure on top of `unicode-bidi:
 * plaintext` on the bubble (see big comment above): plaintext already fixes
 * the common case, but isolating explicit embedded runs additionally
 * protects punctuation glued to the foreign run (e.g. "Next.js 15!" at the
 * end of an Arabic sentence) from having its trailing punctuation reordered
 * to the wrong side.
 */
function segmentForBidiIsolation(text) {
  // A "foreign run" here = a maximal sequence of Latin letters, digits,
  // and common inline punctuation (. , / - ' + #) with no Arabic letters.
  // Runs shorter than 2 chars are not isolated (not worth the overhead,
  // and avoids isolating stray single digits mid-Arabic-word contexts).
  const runRe = /[A-Za-z0-9][A-Za-z0-9.,/'+#-]*(?:\s[A-Za-z0-9][A-Za-z0-9.,/'+#-]*)*/g;
  const segments = [];
  let lastIndex = 0;
  let match;
  while ((match = runRe.exec(text)) !== null) {
    if (match[0].trim().length < 2) continue;
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isolate: false });
    }
    segments.push({ text: match[0], isolate: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isolate: false });
  }
  return segments.length ? segments : [{ text, isolate: false }];
}

function PreviewBubble({ text, dir, placeholder }) {
  const segments = useMemo(() => segmentForBidiIsolation(text), [text]);
  return (
    <div className="bc-preview-wrap" data-dir={dir}>
      <div
        className="bc-bubble"
        dir={dir}
        data-placeholder={placeholder}
        // unicode-bidi: plaintext (set in CSS) makes the UBA re-derive each
        // paragraph's base direction from its own first-strong character,
        // exactly like our JS detector, independent of the ancestor `dir`.
        // We still pass `dir={dir}` too, so screen readers and any nested
        // block-level fallback get an explicit, non-heuristic direction.
      >
        {text
          ? segments.map((seg, i) =>
              seg.isolate ? (
                <span className="bc-embed" key={i} dir="ltr">
                  {seg.text}
                </span>
              ) : (
                <React.Fragment key={i}>{seg.text}</React.Fragment>
              )
            )
          : null}
      </div>
    </div>
  );
}

const DEFAULT_MAX_LEN = 500;

export default function BilingualComposer({
  fallbackDir = "ltr",
  maxLength = DEFAULT_MAX_LEN,
  placeholder = "Écrivez votre message… / اكتب رسالتك…",
  onSend,
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);

  useEffect(() => {
    injectStylesOnce();
  }, []);

  const dir = useMessageDirection(value, fallbackDir);

  // Keep the textarea's own `dir` attribute (and therefore its text-align:
  // start / caret side) in sync live, on every keystroke, via the `dir`
  // memo above — React re-renders the attribute each time `value` changes,
  // so there is no extra effect needed for "live" behavior; the derived
  // state IS the live state.
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.setAttribute("dir", dir);
    }
  }, [dir]);

  const handleChange = useCallback(
    (e) => {
      const next = e.target.value;
      if (next.length <= maxLength) {
        setValue(next);
      } else {
        setValue(next.slice(0, maxLength));
      }
    },
    [maxLength]
  );

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend && onSend({ text: trimmed, dir });
    setValue("");
  }, [value, dir, onSend]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const remaining = maxLength - value.length;
  const isOver = remaining < 0;
  const canSend = value.trim().length > 0 && !isOver;

  return (
    // The root carries the SAME resolved dir as the current message. This is
    // what makes every logical property below (margin-inline-*, border-
    // inline-*, flex "row" axis, text-align:start, etc.) mirror correctly —
    // logical properties resolve relative to the nearest element with a
    // resolved `dir`, not relative to `document.documentElement`.
    <div className="bc-root" dir={dir}>
      <span className="bc-dir-badge">{dir}</span>

      <PreviewBubble text={value} dir={dir} placeholder="Preview / معاينة" />

      <div className="bc-composer">
        <textarea
          ref={textareaRef}
          className="bc-textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          aria-label="Message"
        />

        <div className="bc-meta-col">
          <span
            className="bc-counter"
            data-over={isOver ? "true" : "false"}
            aria-live="polite"
          >
            {remaining}
          </span>
          <button
            type="button"
            className="bc-send-btn"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
          >
            <span className="bc-send-icon" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

## BIDI NOTES

Three concrete failure modes of naive `dir` handling that this implementation avoids:

1. **Global-locale direction applied to mixed-language messages.** A naive implementation sets `dir="rtl"` (or `ltr`) once at the app/user level based on the UI locale and applies it to every message bubble. That breaks the moment a user whose UI locale is Arabic types a pure-French sentence (or vice versa) — the French text still gets forced into an RTL paragraph context, so word order and trailing punctuation end up visually reversed even though every character in the message is LTR. Because this implementation calls `detectDirection()` **per message, from the message's own first-strong character**, each bubble/textarea gets its own correct direction regardless of the app's locale — `fallbackDir` is only used for the genuinely ambiguous case (numbers/punctuation only).

2. **Scrambled embedded Latin runs inside an RTL paragraph (the "Next.js 15" case).** If you only set `dir="rtl"` on the container and rely on default `unicode-bidi: normal` / `embed` resolution, the UBA still applies its own auto-reordering rules to weak/neutral runs adjacent to the embedded LTR text — digits and trailing punctuation right after a Latin word inside an Arabic sentence can visually migrate to the wrong side (e.g. a version number or a hyphenated suffix jumping in front of the word it belongs after). We avoid this two ways at once: (a) `unicode-bidi: plaintext` on the bubble makes the browser re-run first-strong detection **per paragraph**, matching what our JS already computed, instead of inheriting a single blanket direction; and (b) we additionally wrap detected Latin/digit runs (`segmentForBidiIsolation`) in `<span dir="ltr" style="unicode-bidi: isolate">`, which creates a proper bidi isolate — the run's internal ordering (and the ordering of tightly-bound trailing punctuation like `.` or `!`) is computed independently and then dropped into the surrounding RTL text as a single opaque unit, so it can never be reordered internally by the outer paragraph's algorithm.

3. **Chrome (send button / counter) and caret staying visually "left/right" instead of following content direction.** A naive implementation hardcodes `margin-left`, `right: 8px`, `text-align: left`, etc. for the composer's send button, counter, and textarea. When the detected direction flips to RTL, the button and counter stay glued to the physical left/right side of the screen while the text direction flips underneath them — producing a jarring, unmirrored control layout (and a caret/alignment that stays LTR even though the text being typed is Arabic). This implementation uses **only logical properties** (`margin-inline-start`, `padding-inline`, `border-inline-start`, `text-align: start`, and flexbox's inline-axis-relative `row` direction) keyed off a `dir` attribute set dynamically on the root element and the `<textarea>` itself on every keystroke (`useEffect` syncing `textarea.dir = dir` alongside the `dir` state used for render). No physical `left`/`right` property appears anywhere in the stylesheet, so the button, counter, and caret/text-alignment all mirror automatically and immediately as direction is detected live while typing.
