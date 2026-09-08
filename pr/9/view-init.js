/*
 * Applies the saved view before the body is parsed, so someone who chose the
 * compact view never watches the roomy one flash first. This is a separate file
 * rather than an inline <script> because the CSP is script-src 'self' with no
 * 'unsafe-inline' — the usual anti-flash trick is not available here.
 *
 * Kept deliberately tiny: it blocks parsing.
 */
try {
  var v = JSON.parse(localStorage.getItem('hc.view'));
  if (v === 'compact') document.documentElement.dataset.view = v;
} catch (e) {
  /* Storage can be blocked entirely; the default view is the right fallback. */
}
