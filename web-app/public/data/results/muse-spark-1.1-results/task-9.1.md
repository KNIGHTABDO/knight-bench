In App Router, SSG renders at build time. No server hit on request; user gets instant CDN-cached HTML. Use for static marketing pages.

SSR renders on every request. Server hit per navigation; user waits for full HTML. Use for personalized or always-fresh data.

ISR is SSG with timed revalidation. First request after build serves cached HTML instantly; background revalidation hits server to regenerate static file via revalidate interval. User sees fast page, occasionally slightly stale. Use for blogs or catalogs that change but tolerate delay.

Streaming SSR still renders per request but streams HTML progressively via Suspense boundaries. Server hit per request, yet user sees shell immediately then chunks populate. Use when SSR is needed but some components are slow.
