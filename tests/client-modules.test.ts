// Tests de sanidad de los 5 modulos de cliente (src/client/{core,map,list,ui,
// features}.js). Desde B2 el cliente ya NO vive como strings en template literals
// (src/html/client/*.ts, escapes doblados) sino como ficheros de FUENTE REAL con
// escapes simples, que scripts/gen-client-bundle.mjs concatena en public/static/app.js.
// Aqui leemos esos ficheros como texto y validamos:
//   1. Cada modulo parsea (sin syntax errors) como JS — new Function, lo mas
//      parecido a lo que hace el navegador al ejecutar el bundle.
//   2. La concatenacion completa (core+map+list+ui+features, el orden del bundle)
//      tambien parsea con el prelude APP_VER.
//   3. Simbolos clave presentes (detecta splits accidentales o borrados).
//   4. Las regex de horario llevan escapes reales (\d, \s), no colapsados.
//
// NO ejecutamos el bundle — depende de globals del navegador (window, document,
// Leaflet, APP_VER...). Solo validamos que el parse AST es valido.
import { describe, it, expect } from 'vitest'
// Importamos los ficheros de fuente como TEXTO (?raw, tipado por vite/client como
// string; vitest lo resuelve leyendo el fichero). Evita depender de @types/node.
import clientCoreScript     from '../src/client/core.js?raw'
import clientMapScript      from '../src/client/map.js?raw'
import clientListScript     from '../src/client/list.js?raw'
import clientUiScript       from '../src/client/ui.js?raw'
import clientFeaturesScript from '../src/client/features.js?raw'

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
  it('core.js parsea sin errores', () => {
    const r = parseOk(clientCoreScript)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })
  it('map.js parsea sin errores', () => {
    const r = parseOk(clientMapScript)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })
  it('list.js parsea sin errores', () => {
    const r = parseOk(clientListScript)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })
  it('ui.js parsea sin errores', () => {
    const r = parseOk(clientUiScript)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })
  it('features.js parsea sin errores', () => {
    const r = parseOk(clientFeaturesScript)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })

  it('los modulos no estan vacios (guardrail contra regresiones de split)', () => {
    expect(clientCoreScript.length).toBeGreaterThan(10000)
    expect(clientMapScript.length).toBeGreaterThan(20000)
    expect(clientListScript.length).toBeGreaterThan(20000)
    expect(clientUiScript.length).toBeGreaterThan(20000)
    expect(clientFeaturesScript.length).toBeGreaterThan(10000)
  })
})

describe('bundle completo (orden del gen-client-bundle)', () => {
  it('core+map+list+ui parsea concatenado con prelude APP_VER', () => {
    const js = 'var APP_VER = "0.0.0-test";\n'
      + clientCoreScript + '\n'
      + clientMapScript + '\n'
      + clientListScript + '\n'
      + clientUiScript
    const r = parseOk(js)
    expect(r.ok, 'ok' in r ? '' : (r as any).err).toBe(true)
  })

  it('el bundle completo (critico + features) parsea', () => {
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

describe('core — regex de horario con escapes reales (QW1)', () => {
  // Bug historico (cuando el cliente vivia en template literals): /(\d{1,2}:\d{2})/
  // podia colapsar a /(d{1,2}:d{2})/ y romper isOpenNow. Ya no vive en un literal,
  // pero mantenemos el guardian: la fuente debe tener las regex reales.
  it('tiene \\d y \\s reales en las regex de isOpenNow', () => {
    expect(clientCoreScript).toContain('(\\d{1,2}:\\d{2})')
    expect(clientCoreScript).toContain(':\\s*(.+)$')
    expect(clientCoreScript).not.toContain('(d{1,2}:d{2})')
  })
})

describe('features — trend strip y comparador modal', () => {
  it('contiene trend strip y wiring del comparador modal', () => {
    expect(clientFeaturesScript).toContain('trend-strip')
    expect(clientFeaturesScript).toContain('openCompareModal')
  })
})

describe('features — swipe-to-dismiss bottom sheet (Ship 22)', () => {
  it('tiene el wiring de arrastre para cerrar bottom sheets en movil', () => {
    expect(clientFeaturesScript).toContain('Ship 22')
    expect(clientFeaturesScript).toContain('.modal-backdrop.show')
    expect(clientFeaturesScript).toContain('translateY(')
  })
})

describe('list — pull-to-refresh (Ship 21)', () => {
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
  // Contrato implicito de globales entre modulos. Si uno se elimina por error,
  // el cliente rompe silenciosamente en prod (ReferenceError en consola).
  const KEY_SYMBOLS: Array<{ name: string; in: string[] }> = [
    { name: 'function loadStations',    in: ['list'] },
    { name: 'function applyFilters',    in: ['list'] },
    { name: 'function renderMarkers',   in: ['map'] },
    { name: 'function buildPopup',      in: ['map'] },
    // Capa de electrolineras (se perdió una vez en el refactor B2: guardarla).
    { name: 'function loadChargers',      in: ['map'] },
    { name: 'function buildChargerPopup', in: ['map'] },
    { name: 'function setChargersVisible', in: ['map'] },
    { name: 'function toggleCompare',   in: ['list'] },
    { name: 'function openCompareModal', in: ['list'] },
    { name: 'function renderCompareModal', in: ['list'] },
    { name: 'function openHistoryModal',  in: ['list'] },
    { name: 'function closeHistoryModal', in: ['list'] },
    { name: 'function enableTelegramAlerts',      in: ['core'] },
    { name: 'function disableTelegramAlerts',     in: ['core'] },
    { name: 'function telegramAlertsActive',      in: ['core'] },
    { name: 'function telegramServerConfigured',  in: ['core'] },
    { name: 'function enableSync',    in: ['core'] },
    { name: 'function syncPull',      in: ['core'] },
    { name: 'function syncPush',      in: ['core'] },
    { name: 'function prefersReducedMotion', in: ['core'] },
    { name: 'function scrollBehavior',  in: ['core'] },
    { name: 'function showToast',       in: ['core'] },
    { name: 'function initPWAUX',       in: ['core'] },
    { name: 'function showUpdateToast', in: ['ui']   },
    { name: 'function initFreshnessBadge',       in: ['core'] },
    { name: 'function initNationalStatsWidget', in: ['core'] },
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
