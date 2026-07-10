SCORE: 8 (FINAL)
AUTO_CHECKS: 4/4, failures: none
BAND_JUSTIFICATION: This is a strong 7-8 implementation: the first-strong detector covers Arabic extensions, the CSS has no physical direction properties, and the preview uses `unicode-bidi: isolate`. Its BIDI notes discuss neutral-only fallback, embedded `Next.js 15`, punctuation, and trailing digits rather than offering generic RTL advice. The JSX scaffold compiles. It does not reach 9-10 because it does not fully separate chrome direction from input direction or address Arabic-Indic versus European digit product policy in the component itself.
UNVERIFIED_CLAIMS: Browser-specific bidi behavior across the target support matrix.
RED_FLAGS: none
