// Orquestador del script de cliente. Hasta v1.8 el fichero monolitico tenia
// 5400+ lineas; para que sea navegable lo hemos partido en 5 modulos que
// exportan cada uno un string con una seccion del JS. En build-time (vite)
// se concatenan en un unico bloque inline — el output servido al navegador
// es byte-identico al del monolitico, solo cambia la vida como codigo.
//
// Orden de concatenacion: importa. Muchas funciones se declaran en un modulo
// y se consumen desde IIFEs en otro (ej. `buildPopup` en map.ts se usa desde
// el delegate de popups en ui.ts). Mantenemos el orden original del fichero
// historico para no romper referencias hoisted: core -> map -> list -> ui ->
// features. La orquestacion completa: prelude (APP_VER), piezas en orden, y
// coda de diagnostico (console.info con la version visible en DevTools).
import { clientCoreScript }     from './client/core'
import { clientMapScript }      from './client/map'
import { clientListScript }     from './client/list'
import { clientUiScript }       from './client/ui'
import { clientFeaturesScript } from './client/features'

export function getClientScript(nonce: string, version: string = '0.0.0'): string {
  // El nonce debe coincidir con el del header CSP para que el script se ejecute.
  // __APP_VERSION__ se inyecta desde el server: queda accesible como var global 'APP_VER'.
  return `<script nonce="${nonce}">
var APP_VER = ${JSON.stringify(version)};
${clientCoreScript}
${clientMapScript}
${clientListScript}
${clientUiScript}
${clientFeaturesScript}
// ---- VERSION visible en consola (ayuda a diagnosticar sin ingenieria inversa) ----
try { console.info('%cGasolineras Espana v' + APP_VER, 'color:#16a34a;font-weight:bold'); } catch(_) {}
</script>`
}
