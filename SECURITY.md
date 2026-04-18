# Security Policy

## Reportar una vulnerabilidad

Agradecemos la divulgación responsable. Si descubres un fallo de seguridad,
**no abras un issue público**.

Usa uno de estos canales privados:

1. **GitHub Security Advisories** (preferido):
   → [Report a vulnerability](../../security/advisories/new)

2. **Email cifrado** (si existe PGP en tu llavero):
   → security@YOUR_DOMAIN.example

Incluye, si puedes:

- Una descripción reproducible (curl, capturas, vídeo).
- Versión afectada (ver footer de la app o `/api/health`).
- Impacto estimado (qué puede hacer un atacante).
- Cualquier mitigación conocida.

## Qué esperar

| Hito | Plazo objetivo |
|---|---|
| Acuse de recibo | 48 h |
| Triage inicial (severidad, reproducible) | 5 días laborables |
| Parche o mitigación | 30 días (crítico < 7 días) |
| Publicación de advisory | Coordinada con el reportante |

Aceptamos divulgación coordinada: no publicamos detalles hasta tener un
parche desplegado y damos crédito al reportante si lo desea.

## Versiones soportadas

| Versión | Soporte de seguridad |
|---|---|
| 1.4.x (actual) | ✅ activo |
| 1.3.x | ⚠️ parches críticos hasta 2026-07-01 |
| < 1.3 | ❌ sin soporte |

Consulta [`CHANGELOG`](./src/index.tsx) (endpoint `/cambios`) para historial.

## Alcance

Dentro de alcance:

- XSS / CSRF / clickjacking en cualquier ruta de la aplicación.
- Bypass de CSP, SRI, o del rate-limiter.
- SSRF, path traversal, inyección SQL (aunque no haya BD — incluye intentos).
- Exposición de datos personales, geolocalización, o de configuración sensible.
- Fallos de integridad en el snapshot del Ministerio que permitan inyección.
- Vulnerabilidades en dependencias en versiones usadas (`package-lock.json`).

Fuera de alcance:

- Ingeniería social contra el equipo o usuarios.
- Ataques físicos o a la infraestructura de Cloudflare / GitHub.
- Problemas de disponibilidad causados por la API del Ministerio (ajenos a nosotros).
- Ataques que requieren un navegador desactualizado fuera de soporte del fabricante.

## Hardening vigente

- CSP estricta con nonce por request (sin `unsafe-inline` en scripts).
- SRI SHA-384 en todas las dependencias CDN.
- Cabeceras: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy: same-origin`.
- Validación estricta de entrada (regex + zod) antes de cualquier fetch hacia
  sistemas externos — previene SSRF y path traversal.
- Rate limiting por IP en dos capas: `SlidingWindowLimiter` en el Worker +
  reglas de Cloudflare Rate Limiting a nivel de red.
- LRU caches con tope explícito (200 y 10 entradas) — sin exposición a DoS de
  memoria.
- Service Worker con cap de 400 tiles en cache (LRU aprox.) — evita
  agotamiento de storage.
- Origen restringido en `/api/*` (allow-list + `*.pages.dev` + localhost).
- Sin cookies, sin tracking de terceros, sin almacenamiento server-side de
  datos personales.

## security.txt (RFC 9116)

Servimos `/.well-known/security.txt` con los canales de contacto.

---

Gracias por ayudarnos a mantener esto seguro.
