import React, { useMemo, useState } from "react";

const DEFAULT_MAX_LENGTH = 280;

function normalizeFallbackDir(fallbackDir) {
  return fallbackDir === "rtl" ? "rtl" : "ltr";
}

function isInArabicRange(codePoint) {
  return (
    (codePoint >= 0x0600 && codePoint <= 0x06ff) ||
    (codePoint >= 0x0750 && codePoint <= 0x077f) ||
    (codePoint >= 0x08a0 && codePoint <= 0x08ff) ||
    (codePoint >= 0xfb50 && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe70 && codePoint <= 0xfeff)
  );
}

function isLatinStrongLetter(codePoint) {
  return (
    (codePoint >= 0x0041 && codePoint <= 0x005a) ||
    (codePoint >= 0x0061 && codePoint <= 0x007a) ||
    (codePoint >= 0x00c0 && codePoint <= 0x00ff) ||
    (codePoint >= 0x0100 && codePoint <= 0x017f) ||
    (codePoint >= 0x0180 && codePoint <= 0x024f)
  );
}

function isUnicodeLetter(character) {
  return /\p{Letter}/u.test(character);
}

function detectMessageDir(value, fallbackDir = "ltr") {
  const fallback = normalizeFallbackDir(fallbackDir);

  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (isInArabicRange(codePoint) && isUnicodeLetter(character)) {
      return "rtl";
    }

    if (isLatinStrongLetter(codePoint)) {
      return "ltr";
    }
  }

  return fallback;
}

function trimToCodePoints(value, maxLength) {
  const characters = Array.from(value);
  return characters.length > maxLength
    ? characters.slice(0, maxLength).join("")
    : value;
}

const composerStyles = `
.bilingualComposer {
  --composer-bg: #f7f3ec;
  --composer-ink: #202125;
  --composer-muted: #6b665e;
  --composer-line: #d8d0c3;
  --composer-panel: #fffdf9;
  --composer-accent: #126b64;
  --composer-accent-ink: #ffffff;
  --composer-danger: #a64032;

  box-sizing: border-box;
  inline-size: min(100%, 42rem);
  padding-block: 1rem;
  padding-inline: 1rem;
  border: 1px solid var(--composer-line);
  border-radius: 0.5rem;
  background: var(--composer-bg);
  color: var(--composer-ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.bilingualComposer *,
.bilingualComposer *::before,
.bilingualComposer *::after {
  box-sizing: inherit;
}

.bilingualComposer__preview {
  display: flex;
  margin-block-end: 0.75rem;
}

.bilingualComposer__bubble {
  max-inline-size: min(100%, 34rem);
  padding-block: 0.75rem;
  padding-inline: 0.875rem;
  border: 1px solid var(--composer-line);
  border-radius: 0.5rem;
  background: var(--composer-panel);
  color: var(--composer-ink);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  text-align: start;

  /*
    Bidi mechanism: messageDir is computed by our first-strong detector and applied
    as the element dir instead of using dir=auto as hidden state. unicode-bidi:
    isolate then creates a self-contained bidi paragraph, so parent chrome cannot
    leak direction into the message. Inside that isolated context, the browser's
    Unicode Bidirectional Algorithm keeps embedded LTR runs such as
    "مرحبا Next.js 15" coherent, including the trailing digits.
  */
  unicode-bidi: isolate;
}

.bilingualComposer__bubblePlaceholder {
  color: var(--composer-muted);
}

.bilingualComposer__inputShell {
  position: relative;
}

.bilingualComposer__textarea {
  display: block;
  inline-size: 100%;
  min-block-size: 8rem;
  resize: vertical;
  padding-block: 0.875rem 3.25rem;
  padding-inline-start: 4.5rem;
  padding-inline-end: 6.75rem;
  border: 1px solid var(--composer-line);
  border-radius: 0.5rem;
  background: var(--composer-panel);
  color: var(--composer-ink);
  font: inherit;
  line-height: 1.5;
  text-align: start;
  caret-color: var(--composer-accent);
  outline: none;
}

.bilingualComposer__textarea:focus {
  border-color: var(--composer-accent);
  box-shadow: 0 0 0 0.1875rem color-mix(in srgb, var(--composer-accent) 20%, transparent);
}

.bilingualComposer__counter {
  position: absolute;
  inset-block-end: 0.875rem;
  inset-inline-start: 0.875rem;
  color: var(--composer-muted);
  font-size: 0.8125rem;
  line-height: 1;
  pointer-events: none;
}

.bilingualComposer__counter[data-over-limit="true"] {
  color: var(--composer-danger);
}

.bilingualComposer__send {
  position: absolute;
  inset-block-end: 0.625rem;
  inset-inline-end: 0.625rem;
  min-inline-size: 5.5rem;
  min-block-size: 2.25rem;
  padding-block: 0.5rem;
  padding-inline: 0.875rem;
  border: 0;
  border-radius: 0.375rem;
  background: var(--composer-accent);
  color: var(--composer-accent-ink);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.bilingualComposer__send:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.bilingualComposer__send:focus-visible {
  outline: 0.1875rem solid color-mix(in srgb, var(--composer-accent) 35%, transparent);
  outline-offset: 0.125rem;
}
`;

export function BilingualComposer({
  fallbackDir = "ltr",
  maxLength = DEFAULT_MAX_LENGTH,
  onSend,
  placeholder = "Ecris ton message...",
  sendLabel = "Send",
}) {
  const [message, setMessage] = useState("");
  const safeFallbackDir = normalizeFallbackDir(fallbackDir);
  const safeMaxLength = Number.isFinite(maxLength) && maxLength > 0
    ? Math.floor(maxLength)
    : DEFAULT_MAX_LENGTH;

  const messageDir = useMemo(
    () => detectMessageDir(message, safeFallbackDir),
    [message, safeFallbackDir]
  );

  const characterCount = Array.from(message).length;
  const remaining = safeMaxLength - characterCount;
  const canSend = message.trim().length > 0 && remaining >= 0;
  const previewText = message.length > 0 ? message : placeholder;

  function handleChange(event) {
    setMessage(trimToCodePoints(event.target.value, safeMaxLength));
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!canSend) {
      return;
    }

    onSend?.({ text: message, dir: messageDir });
    setMessage("");
  }

  return (
    <section className="bilingualComposer" dir={messageDir} aria-label="Message composer">
      <style>{composerStyles}</style>

      <div className="bilingualComposer__preview" aria-live="polite">
        <div
          className="bilingualComposer__bubble"
          dir={messageDir}
          data-message-dir={messageDir}
        >
          {message.length > 0 ? (
            previewText
          ) : (
            <span className="bilingualComposer__bubblePlaceholder">{previewText}</span>
          )}
        </div>
      </div>

      <form className="bilingualComposer__inputShell" dir={messageDir} onSubmit={handleSubmit}>
        <textarea
          className="bilingualComposer__textarea"
          dir={messageDir}
          value={message}
          onChange={handleChange}
          placeholder={placeholder}
          aria-label="Message text"
          aria-describedby="bilingual-composer-counter"
        />

        <output
          id="bilingual-composer-counter"
          className="bilingualComposer__counter"
          data-over-limit={remaining < 0}
          aria-live="polite"
        >
          {characterCount}/{safeMaxLength}
        </output>

        <button className="bilingualComposer__send" type="submit" disabled={!canSend}>
          {sendLabel}
        </button>
      </form>
    </section>
  );
}

export default BilingualComposer;
