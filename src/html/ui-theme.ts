// Paleta y tipografía compartidas. El mapa conserva su propio tema y controles.
export const PORTAL_TOKENS = `
:root{--eu-paper:#f5f7f4;--eu-surface:#fff;--eu-ink:#17372b;--eu-muted:#5d7167;--eu-accent:#137954;--eu-line:#d9e4dc;--eu-soft:#edf4ec;--eu-lime:#e2f59b;--eu-radius:22px;--eu-font:system-ui,-apple-system,"Segoe UI",sans-serif}
`

export const PORTAL_BASE_CSS = PORTAL_TOKENS + `
*{box-sizing:border-box}
html{color-scheme:light}
body{margin:0;background:var(--eu-paper);color:var(--eu-ink);font:16px/1.55 var(--eu-font)}
h1,h2,h3{font-family:var(--eu-font);color:var(--eu-ink);line-height:1.16;letter-spacing:-.035em}
button,input,select,textarea{font:inherit}
[hidden]{display:none!important}
:focus-visible{outline:3px solid #1462a1;outline-offset:3px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
`
