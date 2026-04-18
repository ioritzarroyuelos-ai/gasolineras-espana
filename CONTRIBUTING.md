# Contribuir a Gasolineras España

Gracias por querer mejorar esto. Los PRs son bienvenidos — pequeños, enfocados
y con test. Cualquier cosa mayor conviene discutirla antes en un issue.

## Flujo de trabajo

1. **Fork + branch** desde `main`: `feat/nombre-corto`, `fix/descripcion`.
2. **Instala**: `npm ci` (no uses `npm install` a menos que cambies deps).
3. **Desarrolla**: `npm run dev` (HMR) o `npm run preview` (wrangler).
4. **Calidad local antes de PR**:
   ```bash
   npm run typecheck      # tsc --noEmit → 0 errores
   npm run test           # vitest → 27/27 passed
   npm run build          # genera iconos + bundle sin errores
   npm run test:e2e       # Playwright + axe (requiere wrangler dev)
   ```
5. **Commit** con mensajes convencionales:
   ```
   feat(ui): añadir modo compacto en tarjetas
   fix(api): rechazar idProv con caracteres no numéricos
   chore(deps): bump hono a 4.13
   docs(readme): actualizar sección de deploy
   test(e2e): cubrir flujo de favoritos
   perf(sw): ampliar TILE_CACHE_MAX a 800
   ```
6. **Push + PR**. El CI se ejecuta automáticamente:
   - Typecheck · tests · build · validación de artifacts.
   - Lighthouse CI (budgets de performance, a11y, SEO).
   - Playwright E2E (home, /privacidad, axe-core).
7. Espera review. Los merges son **squash** para mantener historial limpio.

## Estilo

- TypeScript **strict** activado. No uses `any` excepto en puentes inevitables
  (explícalo en comentario).
- Preferimos **comentarios que expliquen el *por qué***, no el *qué*.
- Los textos visibles al usuario van en español.
- Comentarios y nombres de identificadores en español también (consistente con
  el resto del código).
- Dark mode + `prefers-reduced-motion` son obligatorios en cualquier estilo
  nuevo.
- Accesibilidad: cualquier elemento interactivo nuevo necesita `aria-label`
  y ser navegable con teclado.

## Qué NO va a merge

- PRs sin test para lógica nueva.
- Introducción de dependencias pesadas sin justificación (el bundle importa).
- Código que rompa la CSP (inline scripts/styles, `eval`, `onclick=` en HTML).
- Uso de `localStorage` sin fallback para cuando esté deshabilitado.
- Cambios que tocan `/api/*` sin validación zod del payload externo.
- Eliminación de logs estructurados (`slog`) en rutas críticas — necesarios
  para observabilidad.

## Guía para contribuciones específicas

### Añadir un test unitario

`tests/*.test.ts` usa Vitest con `describe`/`it`/`expect`. Los tests de lógica
pura no necesitan mocks.

```ts
import { describe, it, expect } from 'vitest'
import { miFuncion } from '../src/lib/pure'

describe('miFuncion', () => {
  it('hace X en caso Y', () => {
    expect(miFuncion(input)).toEqual(expected)
  })
})
```

### Añadir un test E2E

`tests/e2e/*.spec.ts` con Playwright. Mantén los tests **rápidos y robustos**:
usa `data-testid` antes que selectores de texto si hay riesgo de i18n.

### Añadir una ruta al servidor

`src/index.tsx` es la app Hono. Si la ruta sirve datos externos, **siempre**
pasa el payload por un schema zod (ver `src/lib/schemas.ts`). Si es una ruta
pública con query params, valida los inputs con `validateId` o similar.

### Añadir un estilo CSS

Edita `src/html/styles.ts`. No añadas `<style>` inline en `shell.ts` — rompe
la auditoría de CSP.

## Seguridad

Ver [`SECURITY.md`](./SECURITY.md). Fallos de seguridad **no van como PR
público** — usa el canal privado.

## Código de conducta

Sé amable, respeta a quienes reportan issues aunque estén equivocados, asume
buena fe. No se tolera acoso.
