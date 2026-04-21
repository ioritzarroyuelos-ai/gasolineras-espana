# Error monitoring — 3 niveles

Sistema automatizado para detectar, notificar y arreglar errores JS que ocurren
en navegadores de usuarios reales en produccion. Tres capas independientes:

```
 Nivel 1 ─ reporter cliente     → envia cada error a /api/client-error
                                   (ver src/html/client.ts :: initErrorReporter)
 Nivel 2 ─ cron Telegram 3x/dia → resumen a tu movil (GitHub Actions)
                                   (ver .github/workflows/error-monitor.yml)
 Nivel 3 ─ agente auto-fix      → abre PR con el parche validado
                                   (ver C:\Users\iorit\.claude\scheduled-tasks\webapp-autofix-agent\SKILL.md)
```

El Nivel 1 funciona solo despues de un deploy. **Nivel 2 y 3 requieren setup
manual** — ver abajo.

---

## 1. Aplicar la migracion D1

Anade la tabla `client_errors` a la base remota (y a la local para dev):

```bash
npx wrangler d1 migrations apply gasolineras-history --remote
npx wrangler d1 migrations apply gasolineras-history --local
```

Verifica con:

```bash
npx wrangler d1 execute gasolineras-history --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name='client_errors';"
```

Debe devolver una fila con `client_errors`.

---

## 2. Configurar el bot de Telegram (Nivel 2)

### 2a. Crear el bot

1. Abre Telegram y busca `@BotFather`.
2. Envia `/newbot` y sigue los pasos (nombre visible + username terminado en `bot`).
3. BotFather responde con un **token** tipo `1234567890:ABC-DEF...`. Guardalo.

### 2b. Obtener tu chat_id

1. Abre una conversacion con tu bot recien creado y envia `/start` (o cualquier mensaje).
2. En otro tab del navegador, abre:
   ```
   https://api.telegram.org/bot<TU_TOKEN>/getUpdates
   ```
3. Busca `"chat":{"id":<NUMERO>,...}`. Ese numero es tu `TELEGRAM_CHAT_ID`.

Alternativa: envia `/start` a `@userinfobot` — te devuelve tu ID directamente.

### 2c. Anadir secrets al repo

GitHub → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`.

| Nombre | Valor |
|---|---|
| `CRON_TOKEN` | (ya existe del cron-ingest) |
| `TELEGRAM_BOT_TOKEN` | el token de BotFather |
| `TELEGRAM_CHAT_ID` | el numero del paso 2b |

### 2d. Probar

Dispara el workflow manualmente para validar antes de esperar al proximo tick:

```
Actions → error-monitor → Run workflow → force_notify: true → Run workflow
```

Si todo esta bien configurado, recibes en Telegram:

```
✅ 2026-04-21 18:00 UTC
Cero errores nuevos en prod.
```

Si falla, el run de Actions indica el problema en los logs.

### 2e. Cadencia

El cron corre automaticamente a las **00:00, 08:00 y 16:00 UTC** (3 veces al
dia, cada 8 horas). En hora peninsular espanola: invierno 01:00/09:00/17:00,
verano 02:00/10:00/18:00.

Cada run envia:
- Si hay errores nuevos → resumen con top 10 agrupados por fingerprint
- Si no hay → nada (por defecto). Con `force_notify=true` envia "cero errores"
  para confirmar que el sistema sigue vivo.

---

## 3. Agente auto-fix (Nivel 3)

Se ha creado como scheduled task de Claude Code:

- **Task ID**: `webapp-autofix-agent`
- **Cadencia**: `0 2,10,18 * * *` local (1h despues del monitor Telegram)
- **Archivo**: `C:\Users\iorit\.claude\scheduled-tasks\webapp-autofix-agent\SKILL.md`

Cada run:
1. Comprueba si hay un PR `autofix` abierto. Si si → sal, no acumular cola.
2. GET /api/admin/errors con `autofix_status=null&min_count=2` — errores
   recurrentes no procesados.
3. Toma el de mayor `count` y lo analiza (stack, url, version).
4. Crea branch `autofix/<fp>-<slug>`, hace un parche **minimo** (max 30 lineas).
5. Valida con `npm run typecheck` + `npx playwright test`.
6. Si verde → commit + push + `gh pr create --label autofix`.
7. Actualiza el error en D1 con `status=pr_opened, pr=<url>`.

**Nunca** mergea. **Siempre** humano revisa.

### Gestion manual del agente

```bash
# Ver scheduled tasks
# (desde Claude Code: panel "Scheduled" en la sidebar, o via MCP)

# Forzar un run ahora mismo
# Claude Code → Scheduled → webapp-autofix-agent → Run now

# Deshabilitar temporalmente
# Claude Code → Scheduled → webapp-autofix-agent → Toggle enabled

# Limpiar status de un error para que el agente lo reintente
npx wrangler d1 execute gasolineras-history --remote \
  --command "UPDATE client_errors SET autofix_status=NULL, autofix_notes=NULL WHERE fingerprint='<fp>';"
```

### Limitaciones deliberadas del agente

- **Max 1 PR abierto a la vez**: prefiero cola corta a spam
- **Max 30 lineas netas modificadas por PR**: cambios grandes → skip para
  review humano
- **Nunca toca**: `migrations/`, `wrangler.toml`, `package.json`, tests
- **Nunca desactiva tests** (`test.skip`/`test.only` prohibidos)
- **Extensiones de navegador** (`chrome-extension://` en stack) → auto-skip
  (no son bugs nuestros)

---

## 4. Endpoints admin

Para inspeccion manual, todos requieren `Authorization: Bearer $CRON_TOKEN`.

| Endpoint | Que hace |
|---|---|
| `GET /api/admin/errors?unnotified=1&limit=100` | errores sin notificar |
| `GET /api/admin/errors?autofix_status=null&min_count=2` | candidatos auto-fix |
| `GET /api/admin/errors?limit=100` | todos, por `last_seen DESC` |
| `POST /api/admin/errors/ack?fingerprints=a,b,c` | marca como notificados |
| `POST /api/admin/errors/autofix?fingerprint=X&status=Y&pr=Z` | actualiza estado |

Status validos para autofix: `queued`, `in_progress`, `pr_opened`, `resolved`,
`skipped`.

---

## 5. Que pasa en el cliente

El reporter esta en `src/html/client.ts` dentro de `initErrorReporter()`:

- Hooks en `window.error` y `window.unhandledrejection`
- Filtra ruido:
  - `ResizeObserver loop` (benigno)
  - `Script error.` sin stack (errores de otros origenes)
  - Stacks que empiezan por `chrome-extension://`, `moz-extension://`, `safari-extension://`
- Dedupe 10s por fingerprint (evita loops)
- POST con `keepalive:true` para que llegue aunque el usuario cierre la pestana
- Rate limit server-side: 20 errores/min/IP (sliding window)

Privacidad:
- **No** se guarda cookie, IP, ni identificador de usuario
- Solo `pathname` de la URL (sin query ni host)
- `user_agent` truncado a 200 caracteres

---

## 6. Troubleshooting

### El cron no envia nada

1. Verifica secrets en GitHub → `Actions` → corre `error-monitor` manualmente con
   `force_notify=true`. Si falla, el log te dice que secret falta.
2. Verifica que la tabla existe: `SELECT count(*) FROM client_errors;`

### El agente auto-fix no corre

1. Comprueba que esta enabled en Claude Code → Scheduled.
2. Verifica que `.dev.vars` contiene `CRON_TOKEN=<valor>` (el agente lo lee de ahi).
3. Verifica que no hay un PR `label:autofix` abierto (el agente no acumula).

### Quiero ver los errores en raw

```bash
curl -H "Authorization: Bearer $CRON_TOKEN" \
  "https://webapp-3ft.pages.dev/api/admin/errors?limit=50" | jq .
```

### Quiero forzar una re-notificacion de un error ya enviado

```bash
npx wrangler d1 execute gasolineras-history --remote \
  --command "UPDATE client_errors SET notified_at=NULL WHERE fingerprint='<fp>';"
```

El proximo tick del cron lo reenviara.
