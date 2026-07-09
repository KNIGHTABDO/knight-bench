import React, { useMemo, useState, useCallback } from "react";

/**
 * BilingualComposer
 * -----------------
 * Message composer for users who freely mix Arabic and French (sometimes in
 * the same message). Direction is detected PER MESSAGE from content via
 * first-strong-character bidi detection — not from a global locale.
 *
 * No dependencies beyond React. No Tailwind. Plain CSS-in-file.
 */

/* -------------------------------------------------------------------------- */
/*  First-strong-character bidi detection                                      */
/* -------------------------------------------------------------------------- */

/**
 * Unicode ranges treated as strong Arabic (RTL) characters, as specified:
 *   U+0600–U+06FF  Arabic
 *   U+0750–U+077F  Arabic Supplement
 *   U+08A0–U+08FF  Arabic Extended-A
 *   U+FB50–U+FDFF  Arabic Presentation Forms-A
 *   U+FE70–U+FEFF  Arabic Presentation Forms-B
 */
function isArabicStrong(codePoint) {
  return (
    (codePoint >= 0x0600 && codePoint <= 0x06ff) ||
    (codePoint >= 0x0750 && codePoint <= 0x077f) ||
    (codePoint >= 0x08a0 && codePoint <= 0x08ff) ||
    (codePoint >= 0xfb50 && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe70 && codePoint <= 0xfeff)
  );
}

/**
 * Strong LTR letters: Basic Latin A–Z/a–z, Latin-1 Supplement letters,
 * and common Latin Extended blocks used by French (accents, œ, etc.).
 * We intentionally do NOT treat digits, punctuation, spaces, or symbols
 * as strong — they are neutrals for first-strong purposes.
 */
function isLatinStrong(codePoint) {
  // A–Z, a–z
  if (
    (codePoint >= 0x0041 && codePoint <= 0x005a) ||
    (codePoint >= 0x0061 && codePoint <= 0x007a)
  ) {
    return true;
  }
  // Latin-1 Supplement letters (À–Ö, Ø–ö, ø–ÿ) — excludes × ÷ and other symbols
  if (
    (codePoint >= 0x00c0 && codePoint <= 0x00d6) ||
    (codePoint >= 0x00d8 && codePoint <= 0x00f6) ||
    (codePoint >= 0x00f8 && codePoint <= 0x00ff)
  ) {
    return true;
  }
  // Latin Extended-A (includes œ Œ, ā, etc. used in French orthography variants)
  if (codePoint >= 0x0100 && codePoint <= 0x017f) {
    return true;
  }
  // Latin Extended-B (partial, common French-adjacent)
  if (codePoint >= 0x0180 && codePoint <= 0x024f) {
    return true;
  }
  return false;
}

/**
 * Returns 'rtl' | 'ltr' | null.
 * null means the string has no strong directional character (numbers,
 * punctuation, whitespace only) — callers fall back to `fallbackDir`.
 *
 * Algorithm: walk code points in order; the first strong Arabic or Latin
 * letter wins. Neutrals are skipped. This mirrors the Unicode Bidirectional
 * Algorithm's "first strong character" heuristic used by `dir="auto"`, but
 * we implement it ourselves so the UI chrome (button, counter) can react
 * independently of the browser's textarea heuristics.
 */
function detectFirstStrongDir(text) {
  if (!text) return null;

  // Iterate by Unicode code point (handles surrogate pairs correctly).
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (isArabicStrong(cp)) return "rtl";
    if (isLatinStrong(cp)) return "ltr";
    // else: neutral / weak — keep scanning
  }
  return null;
}

function resolveDir(text, fallbackDir) {
  return detectFirstStrongDir(text) ?? fallbackDir ?? "ltr";
}

/* -------------------------------------------------------------------------- */
/*  Styles (CSS-in-file; logical properties only for chrome mirroring)         */
/* -------------------------------------------------------------------------- */

const styles = {
  root: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 480,
    margin: "0 auto",
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", "Noto Sans", sans-serif',
    fontSize: 15,
    lineHeight: 1.45,
    color: "#1a1a1a",
  },

  /* Preview bubble — sits above the composer */
  previewSection: {
    marginBlockEnd: 10,
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
    color: "#6b7280",
    marginBlockEnd: 6,
  },
  /**
   * Preview bubble bidi strategy
   * ----------------------------
   * We set `dir` to the resolved message direction AND apply:
   *   unicode-bidi: isolate
   *
   * Why isolation (not just dir=auto or plaintext):
   * 1. `dir` establishes the paragraph base direction so the overall flow
   *    of an Arabic-first message is RTL (and French-first is LTR).
   * 2. `unicode-bidi: isolate` creates a bidi isolation boundary around the
   *    bubble. Embedded opposite-direction runs (e.g. the Latin product name
   *    "Next.js 15" inside an Arabic sentence) are laid out with their own
   *    strong direction without "leaking" and reordering neutrals (spaces,
   *    the digits "15", the period in "Next.js") relative to surrounding
   *    Arabic text. Without isolation, a following sibling or parent with
   *    a different base direction can pull neutrals across the boundary and
   *    visually scramble "15" to the wrong side of "Next.js".
   * 3. We deliberately do NOT use `unicode-bidi: plaintext` alone for the
   *    bubble: plaintext would re-detect per paragraph and can disagree with
   *    our explicit first-strong result used for chrome mirroring. We want
   *    one coherent direction for message + chrome + textarea.
   * 4. `dir="auto"` would be close, but implementing detection ourselves
   *    keeps the preview, textarea, and chrome in lockstep on every keystroke.
   *
   * Combined with isolation, mixed LTR product names inside RTL Arabic
   * messages render with correct internal order: N-e-x-t-.-j-s-[space]-1-5.
   */
  previewBubble: {
    boxSizing: "border-box",
    paddingBlock: 10,
    paddingInline: 14,
    borderRadius: 16,
    background: "#e8f0fe",
    border: "1px solid #c5d4f5",
    color: "#111827",
    /* logical padding only — no left/right */
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    minHeight: 44,
    /* bidi: isolation — see comment above */
    unicodeBidi: "isolate",
  },
  previewEmpty: {
    color: "#9ca3af",
    fontStyle: "italic",
  },

  /* Composer shell */
  composer: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: 16,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },

  textarea: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 96,
    resize: "vertical",
    border: "none",
    outline: "none",
    background: "transparent",
    font: "inherit",
    lineHeight: 1.5,
    color: "inherit",
    /* padding uses logical sides only */
    paddingBlock: 4,
    paddingInline: 2,
    /* caret and alignment follow `dir` set on the element live */
    unicodeBidi: "plaintext",
  },

  /**
   * Footer row: counter + send button.
   * Uses flex + logical margin (margin-inline-start: auto) so the button
   * sits at inline-end: right in LTR, left in RTL. Zero physical left/right.
   */
  footer: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    /* dir on this element (or ancestor) drives inline-start/end mirroring */
  },
  counter: {
    fontSize: 12,
    color: "#6b7280",
    fontVariantNumeric: "tabular-nums",
    /* stay at inline-start of the row */
    flexShrink: 0,
  },
  counterWarn: {
    color: "#b45309",
  },
  counterOver: {
    color: "#dc2626",
    fontWeight: 600,
  },
  sendButton: {
    boxSizing: "border-box",
    /* push to inline-end regardless of writing direction */
    marginInlineStart: "auto",
    paddingBlock: 8,
    paddingInline: 16,
    border: "none",
    borderRadius: 999,
    background: "#2563eb",
    color: "#ffffff",
    font: "inherit",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    flexShrink: 0,
  },
  sendButtonDisabled: {
    background: "#93c5fd",
    cursor: "not-allowed",
  },
  dirBadge: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "#6b7280",
    background: "#f3f4f6",
    borderRadius: 6,
    paddingBlock: 2,
    paddingInline: 6,
    flexShrink: 0,
  },
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} props
 * @param {'ltr'|'rtl'} [props.fallbackDir='ltr']
 *   App default direction when content is neutral-only (digits, punctuation).
 * @param {number} [props.maxLength=500]
 * @param {string} [props.placeholder]
 * @param {(payload: { text: string, dir: 'ltr'|'rtl' }) => void} [props.onSend]
 * @param {string} [props.initialValue='']
 */
export default function BilingualComposer({
  fallbackDir = "ltr",
  maxLength = 500,
  placeholder,
  onSend,
  initialValue = "",
}) {
  const [text, setText] = useState(initialValue);

  const dir = useMemo(
    () => resolveDir(text, fallbackDir),
    [text, fallbackDir]
  );

  const length = text.length;
  const isEmpty = text.trim().length === 0;
  const isOver = length > maxLength;
  const isNear = !isOver && length >= Math.floor(maxLength * 0.9);

  const counterStyle = {
    ...styles.counter,
    ...(isNear ? styles.counterWarn : null),
    ...(isOver ? styles.counterOver : null),
  };

  const handleChange = useCallback((e) => {
    setText(e.target.value);
  }, []);

  const handleSend = useCallback(() => {
    if (isEmpty || isOver) return;
    const payload = { text, dir };
    if (typeof onSend === "function") {
      onSend(payload);
    }
    setText("");
  }, [isEmpty, isOver, text, dir, onSend]);

  const handleKeyDown = useCallback(
    (e) => {
      // Ctrl/Cmd+Enter to send
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const defaultPlaceholder =
    fallbackDir === "rtl"
      ? "اكتب رسالتك… (عربي / français)"
      : "Écrivez votre message… (français / عربي)";

  const canSend = !isEmpty && !isOver;

  return (
    <div style={styles.root} data-testid="bilingual-composer">
      {/* ---------- Preview bubble (above composer) ---------- */}
      <div style={styles.previewSection}>
        <div style={styles.previewLabel}>Preview</div>
        <div
          style={{
            ...styles.previewBubble,
            /* base paragraph direction from first-strong detection */
            direction: dir,
            /* isolation prevents embedded opposite-direction runs from
               reordering neutrals across the bubble boundary — critical so
               Latin product names like "Next.js 15" keep "15" after the name
               when the surrounding sentence is Arabic/RTL. See styles.previewBubble
               comment for full rationale (unicode-bidi: isolate + explicit dir). */
            unicodeBidi: "isolate",
          }}
          dir={dir}
          lang={dir === "rtl" ? "ar" : "fr"}
          aria-live="polite"
          data-testid="preview-bubble"
        >
          {isEmpty ? (
            <span style={styles.previewEmpty}>
              {dir === "rtl" ? "ستظهر معاينة رسالتك هنا" : "Aperçu du message ici"}
            </span>
          ) : (
            text
          )}
        </div>
      </div>

      {/* ---------- Composer: textarea + chrome ---------- */}
      {/*
        The composer shell itself gets `dir={dir}` so CSS logical properties
        (margin-inline-start, padding-inline, etc.) mirror automatically:
        send button → inline-end (right in LTR, left in RTL)
        counter     → inline-start
        No physical left/right properties are used for chrome layout.
      */}
      <div style={styles.composer} dir={dir} data-testid="composer-shell">
        <textarea
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? defaultPlaceholder}
          /* Live direction: alignment + caret follow detected dir as user types */
          dir={dir}
          style={{
            ...styles.textarea,
            direction: dir,
            textAlign: "start", /* logical: right in RTL, left in LTR */
          }}
          rows={4}
          maxLength={maxLength > 0 ? undefined : undefined}
          aria-label="Message"
          data-testid="composer-textarea"
        />

        <div style={styles.footer} data-testid="composer-footer">
          {/* Counter at inline-start */}
          <span style={counterStyle} data-testid="char-counter">
            {length}
            {maxLength != null ? ` / ${maxLength}` : ""}
          </span>

          {/* Optional dir indicator (helpful while testing; non-essential chrome) */}
          <span style={styles.dirBadge} title="Detected message direction" aria-hidden="true">
            {dir.toUpperCase()}
          </span>

          {/*
            Send button: marginInlineStart: 'auto' pins it to inline-end.
            In LTR → right. In RTL → left. Pure logical; no float/left/right.
          */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            style={{
              ...styles.sendButton,
              ...(!canSend ? styles.sendButtonDisabled : null),
            }}
            data-testid="send-button"
          >
            {dir === "rtl" ? "إرسال" : "Envoyer"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Optional demo harness (remove in production if unused)                     */
/* -------------------------------------------------------------------------- */

export function BilingualComposerDemo() {
  const [last, setLast] = useState(null);
  return (
    <div style={{ padding: 24, background: "#f9fafb", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 18, marginBottom: 16 }}>BilingualComposer demo</h1>
      <BilingualComposer
        fallbackDir="ltr"
        maxLength={280}
        onSend={(payload) => setLast(payload)}
      />
      {last && (
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            background: "#111827",
            color: "#e5e7eb",
            borderRadius: 8,
            fontSize: 12,
            overflow: "auto",
          }}
        >
          {JSON.stringify(last, null, 2)}
        </pre>
      )}
    </div>
  );
}
