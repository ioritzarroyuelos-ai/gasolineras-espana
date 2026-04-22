// Tests de sanidad de los 5 modulos cliente (client/core, client/map,
// client/list, client/ui, client/features).
// Hasta v1.8 el cliente era un monolitico de 5400 lineas. Al partirlo en 5
// sub-modulos (cada uno exporta un string JS que se concatena al build)
// queremos asegurar:
//   1. Cada modulo parsea (no syntax errors) como JS — usando new Function
//      que es lo mas parecido a lo que hace el navegador al ejecutar el
//      bloque inline.
//   2. La concatenacion de los 4 criticos (core + map + list + ui) + el
//      features.js generado tambien parsea limpia.
//   3. Ciertos simbolos clave estan presentes en el bundle final (detecta
//      splits accidentales o eliminaciones erroneas).
//
// NO ejecutamos el bundle — el cliente depende de globals del navegador
// (window, document, Leaflet, APP_VER, etc.) que no existen en Node.
// Solo validamos que el parse AST es valido — es la garantia mas fuerte
// que se puede dar sin montar JSDOM + mocks pesados.
import { describe, it, expect } from 'vitest'

import { clientCoreScript }     from '../src/html/client/core'
import { clientMapScript }      from '../src/html/client/map'
import { clientListScript }     from '../src/html/client/list'
import { clientUiScript }       from '../src/html/client/ui'
import { clientFeaturesScript } from '../src/html/client/features'

function parseOk(js: string): { ok: true } | { ok: false; err: string } {
  try {
    // eslint-disable-next-line no-new-func
    new Function(js)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, err: String(e && e.message || e) }
  }
}

describe('cliente modulo por modulo', () => {
  it('core.ts parsea sin errores', () => {
    const r = parseOk(clientCoreScript)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })
  it('map.ts parsea sin errores', () => {
    const r = parseOk(clientMapScript)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })
  it('list.ts parsea sin errores', () => {
    const r = parseOk(clientListScript)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })
  it('ui.ts parsea sin errores', () => {
    const r = parseOk(clientUiScript)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })
  it('features.ts parsea sin errores', () => {
    const r = parseOk(clientFeaturesScript)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })

  it('los modulos no estan vacios (guardrail contra regresiones de split)', () => {
    expect(clientCoreScript.length).toBeGreaterThan(10000)     // ~20 KB
    expect(clientMapScript.length).toBeGreaterThan(20000)      // ~30 KB
    expect(clientListScript.length).toBeGreaterThan(20000)     // ~30 KB
    expect(clientUiScript.length).toBeGreaterThan(30000)       // ~50 KB
    expect(clientFeaturesScript.length).toBeGreaterThan(30000) // ~55 KB
  })
})

describe('bundle completo (critico + features concatenados)', () => {
  it('core+map+list+ui parsea concatenado con prelude APP_VER', () => {
    const js = 'var APP_VER = "0.0.0-test";\n'
      + clientCoreScript + '\n'
      + clientMapScript + '\n'
      + clientListScript + '\n'
      + clientUiScript
    const r = parseOk(js)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })

  it('el bundle completo (critico + features en strings) parsea', () => {
    const js = 'var APP_VER = "0.0.0-test";\n'
      + clientCoreScript + '\n'
      + clientMapScript + '\n'
      + clientListScript + '\n'
      + clientUiScript + '\n'
      + clientFeaturesScript
    const r = parseOk(js)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })
})

describe('features string (fuente del prebuild)', () => {
  // El prebuild escribe public/static/features.js extrayendo el contenido de
  // clientFeaturesScript. Aqui validamos que el string exportado tiene las
  // secciones esperadas — si alguien elimina una feature por error, el test
  // falla antes de llegar a prod.
  it('contiene trend strip, comparador modal y diario', () => {
    expect(clientFeaturesScript).toContain('trend-strip')
    expect(clientFeaturesScript).toContain('openCompareModal')
    expect(clientFeaturesScript).toContain('openDiary')
  })
})

describe('list string — pull-to-refresh (Ship 21)', () => {
  // El IIFE de PTR no exporta funciones (solo wires touch handlers al DOM),
  // asi que validamos por presencia de los simbolos clave del gesto. Si
  // alguien borra la logica por accidente, el test falla.
  it('tiene el wiring pull-to-refresh', () => {
    expect(clientListScript).toContain('ptr-indicator')
    expect(clientListScript).toContain('touchstart')
    expect(clientListScript).toContain('touchmove')
    expect(clientListScript).toContain('touchend')
    expect(clientListScript).toContain('PTR_THRESHOLD')
    expect(clientListScript).toContain('forceReload')
  })
})

describe('simbolos criticos presentes en el bundle', () => {
  // Funciones y variables globales que forman el contrato implicito entre
  // modulos. Si uno se elimina por error, el cliente rompe silenciosamente
  // en prod (en consola: ReferenceError).
  const KEY_SYMBOLS: Array<{ name: string; in: string[] }> = [
    { name: 'function loadStations',    in: ['list'] },
    { name: 'function applyFilters',    in: ['list'] },
    { name: 'function renderMarkers',   in: ['map'] },
    { name: 'function buildPopup',      in: ['map'] },
    { name: 'function toggleCompare',   in: ['list'] },
    { name: 'function openCompareModal', in: ['list'] },
    { name: 'function renderCompareModal', in: ['list'] },
    // Ship 20: modal historico reutilizado desde las cards del listado.
    { name: 'function openHistoryModal',  in: ['list'] },
    { name: 'function closeHistoryModal', in: ['list'] },
    { name: 'function enterRouteMode',   in: ['features'] },
    { name: 'function toggleRouteCorridor', in: ['features'] },
    { name: 'function prefersReducedMotion', in: ['core'] },
    { name: 'function scrollBehavior',  in: ['core'] },
    { name: 'function showToast',       in: ['core'] },
    // Ship 14: PWA UX - install prompt + update toast + offline badge.
    { name: 'function initPWAUX',       in: ['core'] },
    { name: 'function showUpdateToast', in: ['ui']   },
    // Ship 15: freshness badge + national stats widget.
    { name: 'function initFreshnessBadge',       in: ['core'] },
    { name: 'function initNationalStatsWidget', in: ['core'] },
    // Ship 19: predict badge en top-3 cards del listado.
    { name: 'function renderPredictSlots',       in: ['list'] },
  ]
  const modules: Record<string, string> = {
    core:     clientCoreScript,
    map:      clientMapScript,
    list:     clientListScript,
    ui:       clientUiScript,
    features: clientFeaturesScript,
  }
  for (const sym of KEY_SYMBOLS) {
    it('"' + sym.name + '" existe en ' + sym.in.join(','), () => {
      const found = sym.in.some(m => modules[m].includes(sym.name))
      expect(found, 'no se encontro "' + sym.name + '" en: ' + sym.in.join(',')).toBe(true)
    })
  }
})
