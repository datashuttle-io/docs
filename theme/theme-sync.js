/* DataShuttle theme-sync — keeps mdBook's theme in lockstep with the
 * UI's currently-active palette.
 *
 * Two channels:
 *   1. ?theme=<name> in the URL — set by Layout when opening docs from
 *      the UI sidebar. Works across subdomains (docs.datashuttle.ai).
 *   2. localStorage.getItem("datashuttle.theme") — works only when UI
 *      and docs share an origin (embedded /docs/ on the api binary).
 *
 * Mapping: UI's resolved theme is "light" or "dark"; mdBook's themes
 * are "light", "navy", "coal", "ayu", "rust". We map dark → navy,
 * light → light, and accept the explicit mdBook names directly.
 */
(function () {
  try {
    var url = new URL(window.location.href);
    var raw = url.searchParams.get("theme");
    var picked = null;
    if (raw === "dark") picked = "navy";
    else if (raw === "light") picked = "light";
    else if (["light", "navy", "coal", "ayu", "rust"].indexOf(raw) >= 0) picked = raw;

    // Strip ?theme so it doesn't sticky into bookmarks / share links.
    if (raw !== null) {
      url.searchParams.delete("theme");
      var qs = url.searchParams.toString();
      var clean = url.pathname + (qs ? "?" + qs : "") + url.hash;
      history.replaceState({}, "", clean);
    }

    // Fallback to UI's same-origin localStorage if no URL param.
    if (!picked) {
      var ui = localStorage.getItem("datashuttle.theme");
      var sysDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      var resolved =
        ui === "light"
          ? "light"
          : ui === "dark"
            ? "dark"
            : ui === "system"
              ? sysDark
                ? "dark"
                : "light"
              : null; // no UI signal → leave mdBook alone
      if (resolved === "dark") picked = "navy";
      else if (resolved === "light") picked = "light";
    }

    if (!picked) return;

    // No-op if already on the right theme.
    if (document.documentElement.classList.contains(picked)) return;

    // Otherwise persist + apply. mdBook's set_theme expects the name
    // raw; the inline preload re-reads it on next nav too.
    localStorage.setItem("mdbook-theme", JSON.stringify(picked));

    var THEMES = ["light", "navy", "coal", "ayu", "rust"];
    var html = document.documentElement;
    THEMES.forEach(function (t) {
      html.classList.remove(t);
    });
    html.classList.add(picked);

    // Toggle the bundled theme stylesheet — mdBook ships one <link>
    // per theme name, all but the active one are `disabled`.
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    links.forEach(function (l) {
      var m = l.href.match(/\/(light|navy|coal|ayu|rust)\.css(\?|#|$)/);
      if (m) l.disabled = m[1] !== picked;
    });

    // Repaint hljs syntax token classes — they're applied on first
    // load and cached, but the brand-vN.css overlay covers them.
    // Nothing to do beyond the class swap above.
  } catch (_) {
    /* swallow — theme sync is best-effort */
  }
})();
