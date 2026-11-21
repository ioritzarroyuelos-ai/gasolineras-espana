import { appendFileSync, readFileSync } from 'node:fs'
import { DATA_JOBS, necesitaRecuperacion } from './lib/data-recovery.mjs'
import { DATA_REPOSITORY, validaPulso } from './lib/data-clock-protocol.mjs'
import { githubDataRequest } from './lib/github-data-api.mjs'
const repo=process.env.GITHUB_REPOSITORY
if (repo!==DATA_REPOSITORY || process.env.GITHUB_REF!=='refs/heads/main') throw Error('El coordinador solo se ejecuta en main del repositorio autorizado')
if (process.env.GITHUB_EVENT_NAME==='repository_dispatch') {
  const pulse=validaPulso(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),process.env.DATA_APP_CLIENT_ID)
  if (!pulse.current) { console.log('Pulso antiguo: se espera al siguiente'); process.exit(0) }
  console.log('Pulso autenticado: '+pulse.slot)
} else if (!['schedule','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) throw Error('Disparador no admitido')
const request=(path,options={})=>githubDataRequest(path,{token:process.env.GH_TOKEN,...options})
const prefix='/repos/'+repo+'/actions/'
const response=await fetch('https://webapp-3ft.pages.dev/data/service-manifest.json?clock='+Date.now(),{signal:AbortSignal.timeout(20000)})
if (!response.ok) throw Error('No se puede comprobar producción; no se lanzan trabajos a ciegas')
const manifest=await response.json()
if (manifest.schema!==1 || !Array.isArray(manifest.services)) throw Error('Estado publicado no válido')
// También se buscan trabajos antiguos en cola, fuera de las últimas ejecuciones.
const active=[]
for (const status of ['queued','in_progress','waiting','pending','requested']) {
  for (let page=1; ; page++) {
    if (page>10) throw Error('Demasiados trabajos pendientes; se omite el pulso')
    const data=await request(prefix+'runs?branch=main&status='+status+'&per_page=100&page='+page)
    if (!Array.isArray(data.workflow_runs)) throw Error('Listado de trabajos inválido')
    active.push(...data.workflow_runs)
    if (page*100>=data.total_count) break
  }
}
for (const job of DATA_JOBS) {
  const workflow=job.workflow||'fetch-'+job.kind+'.yml', path='.github/workflows/'+workflow
  const list=await request(prefix+'workflows/'+workflow+'/runs?branch=main&per_page=20')
  if (!Array.isArray(list.workflow_runs)) throw Error('Historial de robot inválido')
  const runs=[...active.filter(r=>r.path?.split('@')[0]===path),...list.workflow_runs]
  const decision=necesitaRecuperacion(job,manifest,runs)
  let line=job.kind+': '+decision.reason
  if (decision.retry) {
    // Destinos internos fijos y siempre main. Un POST ambiguo no se repite;
    // el siguiente pulso volverá a consultar los trabajos antes de decidir.
    const result=await request(prefix+'workflows/'+workflow+'/dispatches',{method:'POST',body:{ref:'main',...(job.kind==='telegram'?{inputs:{automatic:'true',dry_run:'false'}}:{})}})
    line+=' → solicitado'+(result?.workflow_run_id?' (run '+result.workflow_run_id+')':'')
    await new Promise(r=>setTimeout(r,1000))
  }
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,'- '+line+'\n')
}
