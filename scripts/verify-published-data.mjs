import { readFileSync } from 'node:fs'
const expected = JSON.parse(readFileSync('dist/data/service-manifest.json', 'utf8'))
if (!/^[a-f0-9]{40}$/.test(expected.revision || '')) throw Error('El artefacto no identifica el commit comprobado')
const origin = 'https://webapp-3ft.pages.dev'
let verified = false
for (let attempt=0; attempt<6; attempt++) {
  try {
    const response = await fetch(origin+'/data/service-manifest.json?verify='+expected.revision, {signal:AbortSignal.timeout(10000)})
    const actual = await response.json()
    if (response.ok && JSON.stringify(actual) === JSON.stringify(expected)) {verified=true;break}
  } catch { /* Puede tardar unos segundos en propagarse el despliegue. */ }
  if (attempt<5) await new Promise(resolve=>setTimeout(resolve,10000))
}
if (!verified) throw Error('Producción no sirve todavía el estado de los datos del artefacto validado')
for (const path of ['/','/gasolineras/','/farmacias/','/tiempo/','/itv/','/politica/','/deportes/']) {
  const r=await fetch(origin+path,{signal:AbortSignal.timeout(20000)})
  if (!r.ok || !(await r.text()).includes('<h1')) throw Error('La página publicada no responde correctamente: '+path)
}
console.log('Comprobado en producción: commit '+expected.revision+' y datos del artefacto validado; las seis secciones responden.')
