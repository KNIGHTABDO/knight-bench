# BilingualComposer

Here is the complete single-file implementation of the `<BilingualComposer />` React component, followed by the **BIDI NOTES** discussing three common failure modes of naive direction handling that this implementation successfully avoids.

```jsx
import React, { useState } from 'react';

/**
 * Custom function to detect the text direction using the first strong character rule.
 * Strongly LTR characters include standard and accented Latin letters (used in French).
 * Strongly RTL characters include the Arabic Unicode ranges specified.
 * Neutral characters (spaces, numbers, punctuation) are skipped.
 */
function detectDirection(text, fallbackDir = 'ltr') {
  if (!text) return fallbackDir;
  
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    
    // Check Arabic (RTL) strong character ranges:
    if (
      (code >= 0x0600 && code <= 0x06FF) ||       // Arabic
      (code >= 0x0750 && code <= 0x077F) ||       // Arabic Supplement
      (code >= 0x08A0 && code <= 0x08FF) ||       // Arabic Extended-A
      (code >= 0xFB50 && code <= 0xFDFF) ||       // Arabic Presentation Forms-A
      (code >= 0xFE70 && code <= 0xFEFF)          // Arabic Presentation Forms-B
    ) {
      return 'rtl';
    }
    
    // Check Latin (LTR) strong character ranges (French letters and accents):
    if (
      (code >= 0x0041 && code <= 0x005A) ||       // A-Z
      (code >= 0x0061 && code <= 0x007A) ||       // a-z
      (code >= 0x00C0 && code <= 0x00FF) ||       // Latin-1 Supplement (accents like é, à, ç)
      (code >= 0x0100 && code <= 0x017F)          // Latin Extended-A
    ) {
      return 'ltr';
    }
  }
  
  // Fall back to the default if only neutral characters are present
  return fallbackDir;
}

export function BilingualComposer({ fallbackDir = 'ltr', onSend, maxLength = 280 }) {
  const [text, setText] = useState('');
  const direction = detectDirection(text, fallbackDir);

  const handleTextChange = (e) => {
    const value = e.target.value;
    if (value.length <= maxLength) {
      setText(value);
    }
  };

  const handleSend = () => {
    if (text.trim()) {
      if (onSend) {
        onSend(text, direction);
      }
      setText('');
    }
  };

  return (
    <div className="bilingual-composer-container">
      <style>{`
        .bilingual-composer-container {
          display: flex;
          flex-direction: column;
          gap: 12px;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, sans-serif;
          max-width: 550px;
          margin-block: 20px;
          margin-inline: auto;
          padding-block: 16px;
          padding-inline: 16px;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background-color: #ffffff;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          box-sizing: border-box;
        }

        /* Preview Bubble layout and styles */
        .preview-bubble-wrapper {
          display: flex;
          flex-direction: column;
          margin-block-end: 6px;
        }

        .preview-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: #718096;
          margin-block-end: 6px;
          text-align: start; /* Align title according to text direction */
        }

        .preview-bubble {
          padding-block: 10px;
          padding-inline: 14px;
          font-size: 0.95rem;
          line-height: 1.5;
          word-break: break-word;
          background-color: #edf2f7;
          color: #2d3748;
          align-self: flex-start; /* flex-start resolves to inline-start automatically */
          
          /* Logical border radius: pointy corner on the starting side */
          border-start-start-radius: 16px;
          border-start-end-radius: 16px;
          border-end-end-radius: 16px;
          border-end-start-radius: 4px;

          /*
            BIDI MECHANISM EXPLANATION:
            We rely on setting the HTML `dir` attribute (dir={direction}) on the bubble element 
            itself, combined with standard CSS isolation. 
            
            Why:
            1. `dir` establishes the paragraph embedding level for the UBA (Unicode Bidirectional Algorithm).
            2. By applying it, the browser implicitly applies bidirectional isolation (unicode-bidi: isolate).
               This ensures that the text inside the bubble behaves as an independent paragraph.
            3. Consequently, neutral-ending sequences like LTR brand names containing numbers/punctuation 
               (e.g., "Next.js 15") resolve their directionality correctly relative to the preceding strong LTR 
               character ("s") instead of getting scrambled or swapped to the wrong side of the RTL sentence 
               boundaries.
          */
          unicode-bidi: isolate;
        }

        .preview-bubble.rtl-bubble {
          background-color: #3182ce;
          color: #ffffff;
        }

        /* Input Composer Body */
        .composer-body {
          display: flex;
          flex-direction: column;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          padding-block: 10px;
          padding-inline: 10px;
          background-color: #f7fafc;
          transition: border-color 0.2s, background-color 0.2s;
        }

        .composer-body:focus-within {
          border-color: #3182ce;
          background-color: #ffffff;
        }

        .composer-textarea {
          width: 100%;
          min-height: 90px;
          border: none;
          outline: none;
          resize: vertical;
          background: transparent;
          font-size: 1rem;
          line-height: 1.5;
          padding: 0;
          box-sizing: border-box;
          color: #1a202c;
          font-family: inherit;
        }

        /* Composer Footer containing logical alignment rules */
        .composer-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-block-start: 10px;
          padding-block-start: 10px;
          border-block-start: 1.5px solid #edf2f7;
        }

        .char-counter {
          font-size: 0.8rem;
          color: #718096;
        }

        .char-counter.limit-near {
          color: #e53e3e;
          font-weight: 700;
        }

        .send-button {
          padding-block: 6px;
          padding-inline: 18px;
          border: none;
          border-radius: 20px;
          background-color: #3182ce;
          color: #ffffff;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .send-button:hover:not(:disabled) {
          background-color: #2b6cb0;
        }

        .send-button:disabled {
          background-color: #cbd5e0;
          color: #a0aec0;
          cursor: not-allowed;
        }
      `}</style>

      {/* Preview Bubble Section */}
      <div className="preview-bubble-wrapper" dir={direction}>
        <span className="preview-label">
          Live Preview ({direction === 'rtl' ? 'Arabic/RTL' : 'French/LTR'})
        </span>
        <div 
          className={`preview-bubble ${direction === 'rtl' ? 'rtl-bubble' : ''}`}
          dir={direction}
        >
          {text || <span style={{ fontStyle: 'italic', color: '#a0aec0' }}>Type your message...</span>}
        </div>
      </div>

      {/* Composer Input Area */}
      <div className="composer-body" dir={direction}>
        <textarea
          className="composer-textarea"
          value={text}
          onChange={handleTextChange}
          placeholder={fallbackDir === 'rtl' ? 'اكتب رسالتك هنا...' : 'Écrivez votre message ici...'}
          dir={direction}
        />
        
        <div className="composer-footer">
          {/* 
            Since the container .composer-body has dir={direction}, 
            Flexbox automatically reverses the flow on the horizontal axis. 
            No physical positioning (left/right, float) is used.
            - LTR: Counter is left, Button is right.
            - RTL: Counter is right, Button is left.
          */}
          <span className={`char-counter ${text.length >= maxLength * 0.9 ? 'limit-near' : ''}`}>
            {text.length} / {maxLength}
          </span>
          
          <button
            className="send-button"
            onClick={handleSend}
            disabled={!text.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
```

## BIDI NOTES: 3 Concrete Failure Modes of Naive Direction Handling

Here are three common bidirectional text layout issues that naive implementations face, and how this component successfully avoids them:

### 1. The "Punctuation Jump" at Sentence Boundaries
* **The Failure Mode:** When an RTL (Arabic) message is typed inside a default LTR container (or vice-versa) without local direction override, trailing punctuation characters (which are neutral, such as `.`, `!`, or `?`) resolve their direction based on the parent block. Consequently, when typing an Arabic sentence ending with a period, the period incorrectly jumps to the far right of the line (beginning of the LTR layout) instead of staying on the left (end of the RTL sentence).
* **Avoided by:** Dynamically calculating the text direction using the first strong character and applying `dir={direction}` to the `<textarea>` and `.preview-bubble`. This forces the text layout engine to treat the container as RTL, ensuring that the trailing neutral character is correctly placed at the end of the RTL text stream (on the left).

### 2. Scrambling of Mixed Inline Runs (e.g., LTR Names ending with Numbers)
* **The Failure Mode:** If an Arabic message contains a Latin brand or product name that ends with a number (like "Next.js 15"), and the parent block is not isolated or has incorrect direction boundaries, the number "15" is treated as neutral. Because it sits adjacent to both LTR characters ("Next.js") and RTL characters (the surrounding Arabic text), the bidi engine may resolve the number's direction relative to the overall RTL layout, causing the "15" to scramble to the right of "Next.js" (rendering as "15 Next.js").
* **Avoided by:** Establishing a clean, isolated paragraph boundary with `<div dir={direction}>` and `unicode-bidi: isolate`. By isolating the preview content, the browser's bidi algorithm treats the text inside as a single independent flow where the Latin name and its trailing digits resolve together as a unified LTR sub-run, keeping the order of "Next.js 15" visually correct.

### 3. Caret Drift and Misaligned Typing Flow
* **The Failure Mode:** Relying on a static stylesheet, a global locale (like setting `dir="ltr"` because the application language is French), or simple `text-align: right` styling to align RTL text. If you only apply alignment, the text shifts to the right, but the keyboard cursor (caret) remains anchored to the left or moves in the opposite direction of the typed characters. Additionally, pressing the left/right arrow keys moves the caret in the reverse visual direction.
* **Avoided by:** Binding the `<textarea>` `dir` attribute live to the detected direction state. Since `dir` is updated instantly on every keystroke, the browser natively updates the text alignment, shifts the caret position, and aligns the horizontal cursor controls to the correct reading order flow (right-to-left for Arabic, left-to-right for French) without lag.
