// Orquestador del script de cliente. Hasta v1.8 el fichero monolitico tenia
// 5400+ lineas; para que sea navegable lo hemos partido en 5 modulos que
// exportan cada uno un string con una seccion del JS. En build-time (vite)
// se concatenan en un unico bloque inline.
//
// Orden de concatenacion: importa. Muchas funciones se declaran en un modulo
// y se consumen desde IIFEs en otro (ej. `buildPopup` en map.ts se usa desde
// el delegate de popups en ui.ts). Mantenemos el orden original del fichero
// historico para no romper referencias hoisted: core -> map -> list -> ui.
//
// Ship 1 (code-splitting): el modulo `features` NO se inlinea aqui. Se
// extrae en prebuild a /static/features.js y se carga via <script defer>
// al final del body (ver shell.ts). Ventajas:
//   - Se descarga en paralelo al parse HTML (no bloquea FCP).
//   - Se cachea como asset estatico con SRI (cambia solo al re-desplegar).
//   - SW lo precachea para uso offline.
//   - HTML inline sigue conteniendo solo el nucleo critico (core/map/list/ui)
//     que es el que pinta la UI primera.
// Las funciones globales expuestas aqui (via `var X = ...` en top-level)
// siguen siendo accesibles desde features.js porque se convierten en props
// de `window`.
import { clientCoreScript }     from './client/core'
import { clientMapScript }      from './client/map'
import { clientListScript }     from './client/list'
import { clientUiScript }       from './client/ui'

export function getClientScript(nonce: string, version: string = '0.0.0'): string {
  // El nonce debe coincidir con el del header CSP para que el script se ejecute.
  // __APP_VERSION__ se inyecta desde el server: queda accesible como var global 'APP_VER'.
  return `<script nonce="${nonce}">
var APP_VER = ${JSON.stringify(version)};
${clientCoreScript}
${clientMapScript}
${clientListScript}
${clientUiScript}
// ---- VERSION visible en consola (ayuda a diagnosticar sin ingenieria inversa) ----
try { console.info('%cGasolineras Espana v' + APP_VER, 'color:#16a34a;font-weight:bold'); } catch(_) {}
</script>`
}
