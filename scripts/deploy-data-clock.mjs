import { createPrivateKey } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DATA_REPOSITORY } from './lib/data-clock-protocol.mjs'
import { githubDataRequest } from './lib/github-data-api.mjs'

// GitHub entrega normalmente PKCS1. La conversión permanece en memoria;
// el Worker sólo recibe PKCS8, compatible con Web Crypto.
export function secretosReloj(env) {
  if (!/^Iv[0-9A-Za-z_.-]+$/.test(env.DATA_APP_CLIENT_ID||'')) throw Error('Client ID del robot no válido')
  try {
    const key=createPrivateKey(env.DATA_APP_PRIVATE_KEY)
    if (key.asymmetricKeyType!=='rsa' || key.asymmetricKeyDetails?.modulusLength<2048) throw Error('RSA requerido')
    return {DATA_APP_CLIENT_ID:env.DATA_APP_CLIENT_ID,DATA_APP_PRIVATE_KEY:key.export({format:'pem',type:'pkcs8'}).toString()}
  } catch { throw Error('La clave del robot no es RSA válida de al menos2048bits') }
}

export async function deployDataClock(env=process.env,io={}) {
  if (env.DATA_CLOCK_ENABLED!=='true' || env.GITHUB_REPOSITORY!==DATA_REPOSITORY || !/^[a-f0-9]{40}$/.test(env.VALIDATED_SHA||'')) throw Error('Despliegue del reloj no autorizado por la configuración')
  const secrets=secretosReloj(env)
  const api=io.request||githubDataRequest
  const assertMain=async()=>{
    const current=await api('/repos/'+DATA_REPOSITORY+'/commits/main',{token:env.GH_TOKEN})
    if (current.sha!==env.VALIDATED_SHA) throw Error('Main avanzó: no se activa el reloj anterior')
  }
  await assertMain()
  const ci=await api('/repos/'+DATA_REPOSITORY+'/actions/workflows/ci.yml/runs?branch=main&status=success&head_sha='+env.VALIDATED_SHA+'&per_page=10',{token:env.GH_TOKEN})
  if (!ci.workflow_runs?.some(r=>r.head_sha===env.VALIDATED_SHA && r.head_branch==='main' && r.conclusion==='success' && ['push','workflow_run','workflow_dispatch'].includes(r.event))) throw Error('Falta CI verde del commit exacto')
  const root=resolve(import.meta.dirname,'..'), config=resolve(root,'wrangler.data-clock.jsonc')
  const raw=JSON.parse(readFileSync(config,'utf8'))
  if (raw.name!=='espana-util-data-clock' || raw.workers_dev!==false || raw.preview_urls!==false) throw Error('Destino del reloj no válido')
  const temp=resolve(root,'.tmp','data-clock-bootstrap.jsonc')
  mkdirSync(resolve(root,'.tmp'),{recursive:true})
  const bootstrap={...raw,main:resolve(root,raw.main),triggers:{crons:[]}}
  delete bootstrap.secrets
  delete bootstrap.$schema
  writeFileSync(temp,JSON.stringify(bootstrap))
  const cli=resolve(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),'bin/wrangler.js')
  const run=io.run||spawnSync
  const childEnv={...env,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'warn',WRANGLER_WRITE_LOGS:'false'}
  delete childEnv.DATA_APP_PRIVATE_KEY
  delete childEnv.DATA_APP_CLIENT_ID
  delete childEnv.GH_TOKEN
  const command=(args,input)=>{
    const result=run(process.execPath,[cli,...args],{cwd:root,env:childEnv,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:180000})
    if (result.status!==0) throw Error('No se completó Wrangler ('+args[0]+', salida '+result.status+')')
  }
  try {
    // Primero se instala sin horario, luego se guardan secretos por stdin.
    command(['deploy','--config',temp])
    command(['secret','bulk','--config',temp],JSON.stringify(secrets))
    await assertMain()
    command(['deploy','--config',config])
    console.log(JSON.stringify({event:'data-clock-deploy',worker:raw.name,revision:env.VALIDATED_SHA,cron:raw.triggers.crons[0]}))
  } finally { unlinkSync(temp) }
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await deployDataClock()
