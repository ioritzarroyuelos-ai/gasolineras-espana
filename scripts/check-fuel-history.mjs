#!/usr/bin/env node
// Diagnóstico de una captura oficial; jamás escribe el histórico publicado.
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fechaArchivoMinisterio,fechaSnapshot,filasSnapshot} from './lib/historico-estatico.mjs'
import {HISTORICO_TIMEOUT_MS} from './lib/historico-descarga.mjs'
const day=process.env.HISTORY_CHECK_DAY || new Date(Date.now()-86400000).toISOString().slice(0,10)
const url=new URL('https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestresHist/'+fechaArchivoMinisterio(day))
const started=performance.now()
const result={checkedAt:new Date().toISOString(),day,timeoutMs:HISTORICO_TIMEOUT_MS,estado:'pendiente'}
let phase='conexion'
try {
  const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(result.timeoutMs)})
  result.headerMs=Math.round(performance.now()-started)
  result.status=response.status
  if (!response.ok) { await response.body?.cancel(); throw Error('HTTP_'+response.status) }
  phase='cuerpo'
  const raw=await response.text()
  result.bodyMs=Math.round(performance.now()-started-result.headerMs)
  result.bytes=Buffer.byteLength(raw)
  phase='contenido'
  const snapshot=JSON.parse(raw)
  result.sourceDate=fechaSnapshot(snapshot)
  result.stations=snapshot.ListaEESSPrecio?.length || 0
  result.prices=filasSnapshot(snapshot).length
  if (result.sourceDate!==day || result.prices<20000) throw Error('CONTENIDO_INCOMPLETO')
  result.estado='verificada'
} catch (error) {
  result.phase=phase
  result.code=error.name==='TimeoutError'?'TIMEOUT':/^HTTP_[1-5]\d\d$|^CONTENIDO_INCOMPLETO$/.test(error.message)?error.message:'DESCARGA_NO_DISPONIBLE'
  process.exitCode=1
}
result.elapsedMs=Math.round(performance.now()-started)
const directory=resolve('.tmp/historico-verificacion')
mkdirSync(directory,{recursive:true})
writeFileSync(resolve(directory,'informe.json'),JSON.stringify(result))
console.log(JSON.stringify(result))
