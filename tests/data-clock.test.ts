import {beforeAll,describe,expect,it,vi} from 'vitest'
// @ts-expect-error Estos tests Node no añaden tipos globales Node al Worker.
import {generateKeyPairSync,verify} from 'node:crypto'
// @ts-expect-error El tsconfig de la aplicación define tipos del Worker.
import {readFileSync} from 'node:fs'
// @ts-expect-error El tsconfig de la aplicación define tipos del Worker.
import {createRequire} from 'node:module'
// @ts-expect-error Worker JavaScript sin dependencias de Node.
import worker,{appJwt,sendClockPulse} from '../workers/data-clock.mjs'
// @ts-expect-error Protocolo compartido Node/Workers.
import {DATA_REPOSITORY,DATA_REPOSITORY_ID,DATA_APP_BOT_ID,DATA_APP_SLUG,DATA_CLOCK_EVENT,clockPayload,validaPulso} from '../scripts/lib/data-clock-protocol.mjs'
// @ts-expect-error Cliente compartido Node/Workers.
import {githubDataRequest} from '../scripts/lib/github-data-api.mjs'
// @ts-expect-error Preparación exclusiva del despliegue Node.
import {secretosReloj,deployDataClock} from '../scripts/deploy-data-clock.mjs'
const now=Date.parse('2026-11-20T17:17:00Z'),client='Iv1TestClient',sha='a'.repeat(40)
let pkcs1:string,pkcs8:string,publicKey:string
beforeAll(()=>{const pair=generateKeyPairSync('rsa',{modulusLength:2048});pkcs1=pair.privateKey.export({format:'pem',type:'pkcs1'}).toString();pkcs8=pair.privateKey.export({format:'pem',type:'pkcs8'}).toString();publicKey=pair.publicKey.export({format:'pem',type:'spki'}).toString()})
const env=()=>({DATA_APP_CLIENT_ID:client,DATA_APP_PRIVATE_KEY:pkcs8})
const event=()=>({action:DATA_CLOCK_EVENT,repository:{id:DATA_REPOSITORY_ID,full_name:DATA_REPOSITORY,default_branch:'main'},sender:{id:DATA_APP_BOT_ID,login:DATA_APP_SLUG+'[bot]',type:'Bot'},client_payload:clockPayload(client,now)})

describe('pulso autenticado y limitado al repositorio',()=>{
  it('firma RS256 comprobable, con desfase60s y vencimiento menor10min',async()=>{
    const jwt=await appJwt(client,pkcs8,now),[head,payload,sig]=jwt.split('.')
    const decode=(text:string)=>atob(text.replaceAll('-','+').replaceAll('_','/'))
    expect(JSON.parse(decode(head))).toEqual({alg:'RS256',typ:'JWT'})
    expect(JSON.parse(decode(payload))).toEqual({iat:now/1000-60,exp:now/1000+540,iss:client})
    expect(verify('RSA-SHA256',new TextEncoder().encode(head+'.'+payload),publicKey,Uint8Array.from(decode(sig),c=>c.charCodeAt(0)))).toBe(true)
  })
  it.each(['pkcs1','pkcs8'])('normaliza %s en memoria sin modificar identidad',async format=>{
    const result=secretosReloj({...env(),DATA_APP_PRIVATE_KEY:format==='pkcs1'?pkcs1:pkcs8})
    expect(result.DATA_APP_PRIVATE_KEY).toBe(pkcs8)
    await expect(appJwt(client,result.DATA_APP_PRIVATE_KEY,now)).resolves.toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
  })
  it('rechaza clave noRSA y claveRSA insuficiente',()=>{
    const weak=generateKeyPairSync('rsa',{modulusLength:1024}).privateKey.export({format:'pem',type:'pkcs1'}).toString()
    const ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'pem',type:'pkcs8'}).toString()
    for(const key of [weak,ec,'invalid'])expect(()=>secretosReloj({...env(),DATA_APP_PRIVATE_KEY:key})).toThrow(/RSA/)
  })
  it('admite la identidad y el identificador horario correctos',()=>expect(validaPulso(event(),client,now)).toEqual({current:true,slot:'2026-11-20T17:15:00.000Z'}))
  it.each(['sender','repo','client','extra','slot'])('rechaza manipulación de %s',kind=>{
    const e=event()
    if(kind==='sender')e.sender.id++
    if(kind==='repo')e.repository.full_name='otro/repo'
    if(kind==='client')e.client_payload.appClientId='IvOther'
    if(kind==='extra')e.client_payload.workflow='malicioso.yml'
    if(kind==='slot')e.client_payload.slot='2026-11-20T17:16:00.000Z'
    expect(()=>validaPulso(e,client,now)).toThrow()
  })
  it('descarta pulsos antiguos y rechaza pulsos futuros',()=>{
    expect(validaPulso(event(),client,now+3*3600000).current).toBe(false)
    expect(()=>validaPulso(event(),client,now-3600000)).toThrow(/futura/)
  })
  it.each(['correcto','otra-app','otra-instalacion','otro-repositorio','fallo-dispatch'])('conserva aislamiento y revoca token: %s',async mode=>{
    const calls:{path:string;options:any}[]=[]
    const request=async(path:string,options:any)=>{
      calls.push({path,options})
      if(path==='/app')return {id:123,slug:mode==='otra-app'?'other':DATA_APP_SLUG,client_id:client}
      if(path.endsWith('/installation'))return {id:456,app_id:mode==='otra-instalacion'?999:123,account:{login:DATA_REPOSITORY.split('/')[0]}}
      if(path.endsWith('/access_tokens'))return {token:'test-installation',permissions:{contents:'write',metadata:'read'}}
      if(path.startsWith('/installation/repositories'))return {total_count:mode==='otro-repositorio'?2:1,repositories:[{id:DATA_REPOSITORY_ID,full_name:DATA_REPOSITORY}]}
      if(path.endsWith('/dispatches')){if(mode==='fallo-dispatch')throw Error('rejected');return null}
      if(path==='/installation/token')return null
      throw Error('Unexpected request')
    }
    if(mode==='correcto')await expect(sendClockPulse(env(),{request,now:()=>now})).resolves.toMatchObject({repository:DATA_REPOSITORY})
    else await expect(sendClockPulse(env(),{request,now:()=>now})).rejects.toThrow()
    const issue=calls.find(c=>c.path.endsWith('/access_tokens'))
    if(issue){expect(issue.options.body).toEqual({repository_ids:[DATA_REPOSITORY_ID],permissions:{contents:'write'}});expect(calls.at(-1)?.path).toBe('/installation/token')}
    const dispatch=calls.find(c=>c.path.endsWith('/dispatches'))
    if(['correcto','fallo-dispatch'].includes(mode)){expect(dispatch?.path).toBe('/repos/'+DATA_REPOSITORY+'/dispatches');expect(dispatch?.options.body).toEqual({event_type:DATA_CLOCK_EVENT,client_payload:clockPayload(client,now)})}
    else expect(dispatch).toBeUndefined()
  })
  it('HTTP sólo ofrece health de lectura, sin disparador',async()=>{
    expect((await worker.fetch(new Request('https://test/health'))).status).toBe(200)
    expect((await worker.fetch(new Request('https://test/health',{method:'POST'}))).status).toBe(404)
    expect((await worker.fetch(new Request('https://test/trigger'))).status).toBe(404)
  })
})

describe('límites de API y reintentos',()=>{
  it('espera todo Retry-After y conserva el destino',async()=>{
    const sleep=vi.fn(async()=>{}),fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':'7'}})).mockResolvedValueOnce(new Response('{}',{status:200}))
    await githubDataRequest('/test',{token:'test'},{fetch:fetcher,sleep,now:()=>now})
    expect(sleep).toHaveBeenCalledWith(7000);expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('aplaza una espera larga sin recortarla ni insistir',async()=>{
    const sleep=vi.fn(),fetcher=vi.fn().mockResolvedValue(new Response('{}',{status:429,headers:{'Retry-After':'120'}}))
    await expect(githubDataRequest('/test',{token:'test'},{fetch:fetcher,sleep})).rejects.toMatchObject({code:'GITHUB_RETRY_LATER'})
    expect(sleep).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('no duplica POST cuando el servidor no confirma su resultado',async()=>{
    for(const fail of ['network','500']){
      const fetcher=vi.fn(fail==='network'?async()=>{throw Error('timeout')}:async()=>new Response('{}',{status:500}))
      await expect(githubDataRequest('/dispatches',{token:'test',method:'POST',body:{}},{fetch:fetcher})).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
})

describe('publicación protegida del reloj',()=>{
  it('sólo transporta la clave por stdin entre instalación sincron y activación',async()=>{
    const calls:any[]=[]
    const request=async(path:string)=>path.includes('/commits/')?{sha}:{workflow_runs:[{head_sha:sha,head_branch:'main',event:'push',conclusion:'success'}]}
    const run=(executable:string,args:string[],options:any)=>{
      calls.push({executable,args,options})
      if(calls.length===1){const config=readFileSync(args.at(-1),'utf8');expect(config).not.toContain('PRIVATE KEY');expect(JSON.parse(config).triggers.crons).toEqual([])}
      return {status:0}
    }
    await deployDataClock({...env(),DATA_APP_PRIVATE_KEY:pkcs1,DATA_CLOCK_ENABLED:'true',GITHUB_REPOSITORY:DATA_REPOSITORY,VALIDATED_SHA:sha,GH_TOKEN:'test'},{request,run})
    expect(calls.map(c=>c.args[1])).toEqual(['deploy','secret','deploy'])
    for(const c of calls){expect(c.args.join(' ')).not.toContain('PRIVATE KEY');expect(c.options.env.DATA_APP_PRIVATE_KEY).toBeUndefined();expect(c.options.env.GH_TOKEN).toBeUndefined();expect(c.options.env.WRANGLER_WRITE_LOGS).toBe('false')}
    expect(calls[0].options.input).toBeUndefined();expect(calls[2].options.input).toBeUndefined()
    expect(JSON.parse(calls[1].options.input)).toEqual({DATA_APP_CLIENT_ID:client,DATA_APP_PRIVATE_KEY:pkcs8})
  })
  it('no tocaCloudflare si no coincideCI o main',async()=>{
    const run=vi.fn()
    await expect(deployDataClock({...env(),DATA_CLOCK_ENABLED:'true',GITHUB_REPOSITORY:DATA_REPOSITORY,VALIDATED_SHA:sha,GH_TOKEN:'test'},{request:async()=>({sha:'b'.repeat(40)}),run})).rejects.toThrow(/Main/)
    expect(run).not.toHaveBeenCalled()
  })
  it('no activa cron si main avanza después de preparar secretos',async()=>{
    let mainReads=0
    const request=async(path:string)=>path.includes('/commits/')?{sha:++mainReads===1?sha:'b'.repeat(40)}:{workflow_runs:[{head_sha:sha,head_branch:'main',event:'push',conclusion:'success'}]}
    const run=vi.fn(()=>({status:0}))
    await expect(deployDataClock({...env(),DATA_CLOCK_ENABLED:'true',GITHUB_REPOSITORY:DATA_REPOSITORY,VALIDATED_SHA:sha,GH_TOKEN:'test'},{request,run})).rejects.toThrow(/Main/)
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('deja un solo calendario, conserva manuales y el vigilante26h',()=>{
    const yaml=createRequire(import.meta.url)('js-yaml')
    for(const name of ['prices','chargers','guardias','tiempo','itv','politica','deportes']){
      const config=yaml.load(readFileSync('.github/workflows/fetch-'+name+'.yml','utf8'))
      expect(Object.hasOwn(config.on,'workflow_dispatch')).toBe(true)
      expect(config.on.schedule).toEqual(name==='prices'?[{cron:'30 */12 * * *'}]:undefined)
    }
    const coordinator=yaml.load(readFileSync('.github/workflows/data-recovery.yml','utf8'))
    expect(coordinator.on.repository_dispatch.types).toEqual([DATA_CLOCK_EVENT])
    expect(coordinator.jobs.recover.permissions).toEqual({contents:'read',actions:'write'})
    expect(coordinator.jobs.recover.steps[0].with.ref).toBe('${{ github.sha }}')
    expect(readFileSync('.github/workflows/fetch-prices.yml','utf8')).toContain('MAX=$(( 26 * 3600 ))')
    const config=JSON.parse(readFileSync('wrangler.data-clock.jsonc','utf8'))
    expect(config.workers_dev).toBe(false);expect(config.preview_urls).toBe(false)
  })
})
