# BilingualComposer — Single-file React component

```jsx
import React from "react";

function isArabicCodePoint(cp) {
  return (
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  );
}

function isLtrStrongCodePoint(cp) {
  return (
    (cp >= 0x0041 && cp <= 0x005a) ||
    (cp >= 0x0061 && cp <= 0x007a) ||
    (cp >= 0x00c0 && cp <= 0x024f) ||
    (cp >= 0x1e00 && cp <= 0x1eff)
  );
}

function detectDirection(text, fallbackDir) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (isArabicCodePoint(cp)) return "rtl";
    if (isLtrStrongCodePoint(cp)) return "ltr";
  }
  return fallbackDir;
}

export default function BilingualComposer({
  fallbackDir = "ltr",
  maxLength = 280,
  onSend,
  placeholder = "Écrivez un message... اكتب رسالة...",
}) {
  const [value, setValue] = React.useState("");
  const dir = React.useMemo(
    () => detectDirection(value, fallbackDir),
    [value, fallbackDir]
  );

  const count = Array.from(value).length;
  const remaining = maxLength - count;
  const isOver = remaining < 0;

  function handleSend() {
    if (!value.trim() || isOver) return;
    onSend?.(value);
    setValue("");
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="bc-root" dir={dir} data-dir={dir}>
      <style>{`
        .bc-root {
          max-inline-size: 560px;
          margin-inline: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
          font-family: ui-sans-system, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          border: 1px solid #e2e2e2;
          border-radius: 16px;
          padding-inline: 16px;
          padding-block: 16px;
          background: #fff;
          box-shadow: 0 4px 24px rgba(0,0,0,0.06);
        }
        .bc-label {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #888;
          padding-inline: 4px;
        }
        .bc-preview-wrap {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .bc-root[data-dir="rtl"] .bc-preview-wrap {
          align-items: flex-end;
        }
        .bc-preview {
          max-inline-size: 85%;
          min-inline-size: 24px;
          min-block-size: 20px;
          padding-inline: 14px;
          padding-block: 10px;
          border-radius: 18px;
          border-start-start-radius: 6px;
          background: #f1f1f3;
          color: #111;
          font-size: 15px;
          line-height: 1.5;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
          /* BIDI CORE:
             - We set unicode-bidi: plaintext so each paragraph's base direction
               is derived from its own first-strong char (like dir=auto per line)
               and line breaks create isolation boundaries. This keeps an LTR run
               like "Next.js 15" from being split by the surrounding RTL paragraph.
               Without this, the neutral "." and the weak number "15" could be
               resolved to RTL level and visually appear as "15 Next.js" or
               "Next.15 js". plaintext gives per-paragraph detection + isolation.
               - We keep explicit dir={detectedDir} on the root for chrome mirroring
               and for the fallback when plaintext is not supported.
               - For extra safety on mixed inline, every text node is implicitly
               isolated because plaintext resets embedding levels. Alternative
               approach would be to wrap LTR substrings with <bdi> or a span with
               unicode-bidi: isolate + dir=auto, but that requires parsing.
               Here plaintext + dir achieves correct visual order for
               "أستخدم Next.js 15 كل يوم" -> the "Next.js 15" stays contiguous LTR.
          */
          unicode-bidi: plaintext;
          text-align: start;
        }
        .bc-preview:empty::before {
          content: attr(data-placeholder);
          color: #9a9a9a;
        }
        .bc-textarea-wrap {
          display: flex;
          flex-direction: column;
          gap: 8px;
          border: 1px solid #ddd;
          border-radius: 12px;
          padding-inline: 12px;
          padding-block: 10px;
          background: #fafafb;
        }
        .bc-textarea-wrap:focus-within {
          border-color: #111;
        }
        .bc-textarea {
          inline-size: 100%;
          min-block-size: 72px;
          max-block-size: 160px;
          resize: vertical;
          border: 0;
          outline: 0;
          background: transparent;
          font: inherit;
          font-size: 15px;
          line-height: 1.5;
          /* live bidi: direction driven by JS detection, text-align logical start
             ensures caret and alignment follow direction */
          text-align: start;
          unicode-bidi: plaintext;
        }
        .bc-footer {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding-block-start: 4px;
        }
        .bc-counter {
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          color: #777;
          padding-inline: 4px;
          /* logical positioning: always at inline-start */
          margin-inline-end: auto;
          order: 0;
        }
        .bc-counter[data-over="true"] {
          color: #c00;
          font-weight: 700;
        }
        .bc-send {
          appearance: none;
          border: 0;
          border-radius: 999px;
          padding-inline: 18px;
          padding-block: 8px;
          font-size: 14px;
          font-weight: 600;
          background: #111;
          color: #fff;
          cursor: pointer;
          /* logical positioning: uses inline-start auto to place at inline-end */
          margin-inline-start: auto;
          order: 1;
        }
        .bc-root[data-dir="rtl"] .bc-send {
          /* dir on root flips flex start, button moves via logical flow */
        }
        .bc-send:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .bc-hint {
          font-size: 11px;
          color: #999;
          padding-inline: 4px;
        }
      `}</style>

      <div className="bc-label">Preview</div>

      <div className="bc-preview-wrap">
        <div
          className="bc-preview"
          dir={dir}
          data-placeholder="..."
          /* dir is set from first-strong detection, but CSS unicode-bidi:plaintext
             inside ensures correct isolation for mixed content like:
             Arabic + "Next.js 15" => number stays attached to Latin product name
          */
        >
          {value}
        </div>
      </div>

      <div className="bc-textarea-wrap">
        <textarea
          className="bc-textarea"
          dir={dir}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={3}
          style={{ direction: dir }}
        />
        <div className="bc-footer">
          <span className="bc-counter" data-over={isOver}>
            {count} / {maxLength}
          </span>
          <button
            className="bc-send"
            type="button"
            onClick={handleSend}
            disabled={!value.trim() || isOver}
          >
            {dir === "rtl" ? "إرسال" : "Envoyer"}
          </button>
        </div>
      </div>
      <div className="bc-hint">
        dir:{dir} • fallback:{fallbackDir} • detects Arabic U+0600-06FF,0750-077F,08A0-08FF,FB50-FDFF,FE70-FEFF
      </div>
    </div>
  );
}
```

## BIDI NOTES

1. **Failure — Global locale instead of per-message detection:** Naive apps set `<html dir="rtl">` once from user locale and never change. Then a French-only message "Bonjour Next.js 15 !" inside an RTL page gets its "!" placed on the left, parentheses mirrored wrong, and the whole bubble right-aligned while the content is LTR. Implementation avoids this by first-strong detection per message (`detectDirection`) and setting `dir={detected}` on both textarea and preview, falling back only on neutral-only content to `fallbackDir`.

2. **Failure — Scrambling of LTR product names + numbers in RTL context:** With only `dir="rtl"` and no isolation, the string `أستخدم Next.js 15 كل يوم` is one RTL paragraph containing neutrals "." and weak "15". Bidi algorithm can resolve the dot as RTL and push "15" to the left of "Next.js" → visually "أستخدم 15 Next.js كل يوم". Fix: use `unicode-bidi: plaintext` on preview (and textarea) which gives per-paragraph auto direction plus isolation of embedding levels, so the LTR run "Next.js 15" stays an isolated contiguous LTR island. Alternative would require wrapping with `<bdi>` / `span { unicode-bidi: isolate; dir:auto }`. We avoid `dir=auto` alone because it sets only base direction once, not isolation of inner runs.

3. **Failure — Physical CSS `left/right` and static caret:** Using `text-align:left`, `float:right`, `margin-left:auto`, `left:10px` for send button/counter keeps them fixed when direction flips to RTL, so button appears on wrong side and caret stays stuck on left edge while typing Arabic. Also `dir` not updated live means arrow keys behave incorrectly. Fix: never use physical `left/right`; use only logical properties — `margin-inline-start:auto`, `margin-inline-end:auto`, `padding-inline`, `inset-inline-start/end` — and rely on flex + `dir={detected}` on root so flex start flips automatically. Textarea has `dir` and `style={{direction:dir}}` and `text-align:start` updated on every keystroke, so caret, selection and alignment follow detected direction instantly.
