# Security Policy

## Reportar una vulnerabilidad

Agradecemos la divulgación responsable. Si descubres un fallo de seguridad,
**no abras un issue público** ni lo difundas hasta que tengamos un parche.

### Canal preferido (y único oficial)

**GitHub Security Advisories** (privado end-to-end con GitHub):
→ [Report a vulnerability](../../security/advisories/new)

GitHub cifra el hilo, permite colaborar con el reportante en el parche sin
hacerlo público, y al publicar genera un GHSA ID con crédito.

### Qué incluir

- Descripción reproducible (curl, request HTTP, capturas, vídeo).
- Versión afectada (visible en `/api/health` y en el footer de la app).
- Impacto estimado (lo que un atacante puede lograr: RCE, datos, DoS, etc.).
- Mitigaciones conocidas o PoC si lo tienes.

## Qué esperar

| Hito | Plazo objetivo |
|---|---|
| Acuse de recibo | 48 h |
| Triage (severidad, reproducible) | 5 días laborables |
| Parche o mitigación | 30 días (crítico < 7 días) |
| Publicación de advisory | Coordinada con el reportante |

Aceptamos **divulgación coordinada**: no publicamos detalles hasta tener un
parche desplegado y damos crédito al reportante si lo desea.

## Versiones soportadas

Solo la última versión deployada en producción recibe parches. Este es un
proyecto continuous-delivery sin ramas de soporte largas.

| Versión | Soporte de seguridad |
|---|---|
| `main` / último release | ✅ activo |
| Releases anteriores | ❌ sin soporte (actualiza desplegando la última) |

La versión viva está en [`src/lib/version.ts`](./src/lib/version.ts) y se
expone en `GET /api/health`.

## Alcance

**Dentro de alcance:**

- XSS / CSRF / clickjacking en cualquier ruta de la aplicación.
- Bypass de CSP, SRI, o del rate-limiter.
- SSRF, path traversal, inyección SQL (aunque no haya BD — incluye intentos).
- Exposición de datos personales, geolocalización, tokens, o configuración.
- Fallos de integridad en el snapshot del Ministerio que permitan inyección.
- Vulnerabilidades en dependencias en las versiones usadas (`package-lock.json`).
- Timing attacks contra `/api/health` o endpoints con comparación de tokens.

**Fuera de alcance:**

- Ingeniería social contra el equipo o usuarios.
- Ataques físicos o a la infraestructura de Cloudflare / GitHub.
- Problemas de disponibilidad causados por la API del Ministerio (ajenos).
- Ataques que requieren un navegador desactualizado sin soporte del fabricante.
- Rate-limits triggered desde un mismo IP (diseño intencional).

## Hardening vigente

### Plataforma (Cloudflare Workers / Pages)

- HTTPS obligatorio (pages.dev) + **HSTS** `max-age=63072000; includeSubDomains`.
- **CSP** estricta con nonce por request, sin `unsafe-inline` en scripts, con
  `report-uri` a `/api/csp-report` y `report-to` (Reporting API v3).
- **SRI** SHA-384 en todas las dependencias CDN (Leaflet, MarkerCluster,
  FontAwesome).
- Cabeceras: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy:
  same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy`
  con geolocalización solo `self`, cámara/micro/usb/pago/FLoC en blanco.

### Validación de entrada

- Regex + zod + allowlist INE (52 IDs de provincia) antes de cualquier
  passthrough al Ministerio — bloquea SSRF y path traversal.
- Sanitización agresiva del geocoding (bounds, control chars, cap de longitud).
- Validación de lat/lng como números finitos en rango antes de proxying.

### Anti-abuso

- Rate limiting por IP en tres niveles:
  - `SlidingWindowLimiter` in-memory por-Worker (general, geo, ingest, CSP).
  - Reglas de **Cloudflare Rate Limiting** a nivel de red (recomendación en
    `wrangler.jsonc`).
  - **Turnstile** opcional en `/api/ingest` (fail-closed si hay secret).
- LRU caches con tope explícito (200 / 10 / 500 entradas) y Cache API global
  de Cloudflare encima — evita amplificación y DoS de memoria.
- Service Worker con cap de 400 tiles en cache (LRU aprox.) — evita
  agotamiento de almacenamiento del navegador.
- Origen restringido en `/api/*` (subdominios `*.pages.dev` + localhost,
  cualquier otro origen → 403).
- Cap de payload en `/api/ingest` (4 KB) y `/api/csp-report` (8 KB).

### Privacidad

- Sin cookies, sin tracking de terceros, sin almacenamiento server-side de
  datos personales.
- **Proxy de geocoding**: las peticiones a Nominatim salen del Worker — la IP
  del usuario no llega a OpenStreetMap.
- `Permissions-Policy: interest-cohort=()` (opt-out de FLoC/Topics).

### Secretos y config

- `/api/health` con info disclosure mínima por defecto (`{ ok, ts }`); el
  detalle (snapshot, cache sizes, versión) solo se devuelve con un
  `X-Admin-Token` válido comparado en **tiempo constante** (anti-timing).
- `.env*` en `.gitignore`; solo `.env.example` (nombres de variables sin
  valores) vive en el repo.
- Global error handler que devuelve `{ error: 'internal' }` genérico — sin
  stacks, sin paths, sin nombres de funciones en las respuestas 500.

### Automatización CI/CD

- **CodeQL** (SAST) — PRs + push + cron semanal, queries `security-and-quality`.
- **gitleaks** — detecta secretos en cualquier commit del historial completo.
- **OSV-Scanner** — CVEs contra `package-lock.json` (SARIF → Code scanning).
- **npm audit** — gate `high+critical` en runtime deps (`--omit=dev`).
- **Dependabot** — upgrades npm y GitHub Actions semanales, parches de
  seguridad en cualquier momento.
- Cron diario de seguridad aunque no haya commits — detecta CVEs nuevas contra
  deps ya deployadas.

## Hall of Fame

Reporta una vulnerabilidad válida y apareces aquí (si lo deseas).

---

Gracias por ayudarnos a mantener esto seguro.
