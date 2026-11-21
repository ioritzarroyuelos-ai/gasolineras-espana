import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error Herramienta Node, no runtime de navegador.
import { readFileSync, existsSync } from 'node:fs'
// @ts-expect-error Herramienta Node, no runtime de navegador.
import { createRequire } from 'node:module'
// @ts-expect-error Script Node de CI.
import { deployDisponibilidad, disponibilidadExiste, disponibilidadVersion, verificaDisponibilidad, verificaBotDisponibilidad } from '../scripts/deploy-disponibilidad.mjs'
import { derivaGatewayKey, gatewayCanonico, gatewayDigest, gatewayFirma, gatewayVerifica, gatewayChallenge, GATEWAY_PATH_CHECK, GATEWAY_SIGNATURE_HEADER, GATEWAY_REVISION } from '../scripts/lib/disponibilidad-gateway.mjs'
const sha='a'.repeat(40), repo='ioritzarroyuelos-ai/gasolineras-espana', versionId='10000000-0000-4000-8000-000000000001', NOW=Date.UTC(2026,10,21,14)
const cron='fixture_cron_sin_credencial', bot='fixture_bot_ajeno'
const env=(enabled='true')=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:repo,VALIDATED_SHA:sha,DISPONIBILIDAD_ENABLED:enabled,CRON_TOKEN:cron,TELEGRAM_BOT_TOKEN:bot,GH_TOKEN:'fixture-github',CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32),CLOUDFLARE_API_TOKEN:'fixture-cloudflare'})
const config=(file:string)=>JSON.parse(readFileSync(file,'utf8').split(/\r?\n/).filter((line:string)=>!line.trimStart().startsWith('//')).join('\n'))
function fixture(exists=false,afterMain=Infinity){
  let reads=0
  const calls:any[]=[]
  const request=vi.fn(async(path:string)=>path.includes('/commits/')?{sha:++reads>afterMain?'c'.repeat(40):sha}:{workflow_runs:[{head_sha:sha,head_branch:'main',event:'push',conclusion:'success'}]})
  const run=vi.fn((executable:string,args:string[],options:any)=>{calls.push({executable,args,options,config:config(args[args.indexOf('--config')+1])});return{status:0,stdout:'',stderr:''}})
  return{calls,request,run,bot:vi.fn(async()=>true),checkout:()=>({sha,origin:'https://github.com/'+repo+'.git'}),exists:vi.fn(async()=>exists),version:vi.fn(async()=>versionId)}
}
async function reply(options:RequestInit,mutate:(body:any)=>void=()=>{},keyOverride?:string,rawOverride?:string){
  const key=await derivaGatewayKey(cron),request=JSON.parse(String(options.body))
  const body={...request,requestDigest:await gatewayDigest(String(options.body)),workerVersion:versionId,revision:GATEWAY_REVISION,ok:true,
    bot:{expectedUsername:'GasolinerasAlertasBot',credentialUsername:'gasolinerasalertasbot'},
    worker:await gatewayChallenge(key,{nonce:request.nonce,issuedAt:request.issuedAt,expiresAt:request.expiresAt},versionId)}
  mutate(body)
  const raw=rawOverride??gatewayCanonico(body)
  return new Response(raw,{headers:{'Content-Type':'application/json',[GATEWAY_SIGNATURE_HEADER]:await gatewayFirma(keyOverride??key,GATEWAY_PATH_CHECK,raw,'response')}})
}
function safeError(error:Error,code:string){
  expect(error.message).toBe('No se pudo confirmar la pasarela del bot de la web [GATEWAY_'+code+']')
  expect(error.cause).toBeUndefined()
  for(const value of [cron,bot,'api.telegram.org','example.invalid']){expect(error.stack).not.toContain(value);expect(JSON.stringify(error)).not.toContain(value)}
}
describe('CI y pausa independiente de disponibilidad',()=>{
  it('bootstrap apagado, clave derivada sólo stdin y sin secretos heredados por Wrangler',async()=>{
    const io=fixture(),key=await derivaGatewayKey(cron)
    expect(await deployDisponibilidad(env(),io)).toMatchObject({requestedEnabled:true,enabled:true,state:'ready',reason:null,versionId})
    expect(io.bot.mock.invocationCallOrder[0]).toBeLessThan(io.exists.mock.invocationCallOrder[0])
    expect(io.calls.map(c=>c.args[1])).toEqual(['deploy','secret','deploy'])
    expect(io.calls.map(c=>c.config.vars.DISPONIBILIDAD_ENABLED)).toEqual(['false','false','true'])
    expect(JSON.parse(io.calls[1].options.input)).toEqual({DISPONIBILIDAD_GATEWAY_KEY:key})
    for(const c of io.calls){
      for(const value of [cron,bot,key]){expect(c.args.join(' ')).not.toContain(value);expect(JSON.stringify(c.config)).not.toContain(value);expect(JSON.stringify(c.options.env)).not.toContain(value)}
      for(const name of ['CRON_TOKEN','DISPONIBILIDAD_GATEWAY_KEY','TELEGRAM_BOT_TOKEN','GH_TOKEN','GITHUB_TOKEN','DATA_APP_PRIVATE_KEY'])expect(c.options.env[name]).toBeUndefined()
      expect(c.options.env.WRANGLER_WRITE_LOGS).toBe('false')
      expect(c.config.workers_dev).toBe(false);expect(c.config.preview_urls).toBe(false)
      expect(c.config.migrations).toEqual([{tag:'v1',new_sqlite_classes:['DisponibilidadUsuario']}])
    }
    expect(existsSync(io.calls[0].args.at(-1))).toBe(false)
  })
  it('servicio existente verificado no se apaga entre versiones',async()=>{
    const io=fixture(true);await deployDisponibilidad(env(),io)
    expect(io.calls.map(c=>c.args[1])).toEqual(['secret','deploy'])
    expect(io.calls.every(c=>c.config.vars.DISPONIBILIDAD_ENABLED==='true')).toBe(true)
  })
  it.each([false,true])('fase pausada prepara clave sin exigir endpoint nuevo antes de Pages: %s',async exists=>{
    const io=fixture(exists)
    expect(await deployDisponibilidad(env('false'),io)).toMatchObject({requestedEnabled:false,enabled:false,state:'paused'})
    expect(io.calls.map(c=>c.args[1])).toEqual(exists?['secret','deploy']:['deploy','secret'])
    expect(io.calls.every(c=>c.config.vars.DISPONIBILIDAD_ENABLED==='false')).toBe(true)
    expect(JSON.parse(io.calls.find(c=>c.options.input).options.input)).toEqual({DISPONIBILIDAD_GATEWAY_KEY:await derivaGatewayKey(cron)})
    expect(io.bot).not.toHaveBeenCalled()
  })
  it.each([false,true])('fallo preflight pausa sin secret bulk y conserva namespace: %s',async exists=>{
    const io=fixture(exists);io.bot.mockRejectedValue(Object.assign(Error(cron),{code:'GATEWAY_HTTP_503'}))
    expect(await deployDisponibilidad(env(),io)).toMatchObject({requestedEnabled:true,enabled:false,state:'degraded',reason:'GATEWAY_HTTP_503',versionId})
    expect(io.calls.map(c=>c.args[1])).toEqual(['deploy'])
    expect(io.calls[0].config.vars.DISPONIBILIDAD_ENABLED).toBe('false');expect(io.calls[0].options.input).toBeUndefined()
    expect(io.calls[0].config.durable_objects.bindings).toEqual([{name:'DISPONIBILIDAD',class_name:'DisponibilidadUsuario'}])
  })
  it('fallo de publicación no finge una pausa confirmada ni imprime causa externa',async()=>{
    const io=fixture(true);io.bot.mockRejectedValue({message:cron,code:cron});io.run.mockReturnValue({status:1,stdout:cron,stderr:cron})
    await expect(deployDisponibilidad(env(),io)).rejects.toThrow('No se completó Wrangler')
    expect(io.version).not.toHaveBeenCalled()
  })
  it('raíz ausente no escribe clave vacía',async()=>{
    const io=fixture(true)
    expect(await deployDisponibilidad({...env('false'),CRON_TOKEN:''},io)).toMatchObject({enabled:false,state:'degraded',reason:'GATEWAY_CREDENTIAL_INVALID'})
    expect(io.calls.map(c=>c.args[1])).toEqual(['deploy'])
  })
  it.each(['','yes','undefined'])('bandera ambigua %s rechazada sin recursos',async value=>{
    const io=fixture();await expect(deployDisponibilidad(env(value),io)).rejects.toThrow();expect(io.run).not.toHaveBeenCalled();expect(io.request).not.toHaveBeenCalled()
  })
  it.each(['repo','checkout','origin','ci','main','local'])('contexto %s rechazado antes de recursos',async mismatch=>{
    const io=fixture(),settings=env()
    if(mismatch==='repo')settings.GITHUB_REPOSITORY='otra/persona'
    if(mismatch==='checkout')io.checkout=()=>({sha:'f'.repeat(40),origin:'https://github.com/'+repo+'.git'})
    if(mismatch==='origin')io.checkout=()=>({sha,origin:'https://github.com/otra/persona.git'})
    if(mismatch==='ci')io.request.mockImplementation(async path=>path.includes('/commits/')?{sha}as any:{workflow_runs:[]}as any)
    if(mismatch==='main')io.request.mockResolvedValue({sha:'c'.repeat(40)}as any)
    if(mismatch==='local')settings.GITHUB_ACTIONS='false'
    await expect(deployDisponibilidad(settings,io)).rejects.toThrow();expect(io.run).not.toHaveBeenCalled();expect(io.exists).not.toHaveBeenCalled()
  })
  it.each([false,true])('main avanzado antes de primera mutación no publica: %s',async exists=>{
    const io=fixture(exists,1);await expect(deployDisponibilidad(env(),io)).rejects.toThrow(/Main/);expect(io.run).not.toHaveBeenCalled()
  })
  it.each([false,true])('main avanzado después de secreto no activa: %s',async exists=>{
    const io=fixture(exists,exists?2:3);await expect(deployDisponibilidad(env(),io)).rejects.toThrow(/Main/)
    expect(io.calls.map(c=>c.args[1])).toEqual(exists?['secret']:['deploy','secret']);expect(io.version).not.toHaveBeenCalled()
  })
})
describe('Prueba firmada de Pages y Worker',()=>{
  it('un único POST fijo confirma nonce, clave, identidad y versión, sin Telegram directo',async()=>{
    const publicIdentity=vi.fn(),fetcher=vi.fn(async(_url:string,options:RequestInit)=>reply(options))
    expect(await verificaBotDisponibilidad(env(),{fetch:fetcher,now:()=>NOW,publicIdentity,expectedVersion:versionId})).toEqual({ok:true,versionId,revision:GATEWAY_REVISION})
    expect(fetcher).toHaveBeenCalledOnce()
    const [url,options]=fetcher.mock.calls[0],request=JSON.parse(String(options.body))
    expect(url).toBe('https://webapp-3ft.pages.dev'+GATEWAY_PATH_CHECK);expect(options).toMatchObject({method:'POST',redirect:'manual',cache:'no-store'})
    expect(request.expiresAt-request.issuedAt).toBe(30000)
    expect(await gatewayVerifica(await derivaGatewayKey(cron),GATEWAY_PATH_CHECK,String(options.body),new Headers(options.headers).get(GATEWAY_SIGNATURE_HEADER)!)).toBe(true)
    expect(String(options.body)).not.toContain(cron)
    expect(publicIdentity).toHaveBeenCalledExactlyOnceWith({expectedUsername:'GasolinerasAlertasBot',credentialUsername:'gasolinerasalertasbot'})
  })
  it.each([
    ['nonce',(b:any)=>{b.nonce=crypto.randomUUID()},'RESPONSE_INVALID'],
    ['digest',(b:any)=>{b.requestDigest='d'.repeat(64)},'RESPONSE_INVALID'],
    ['version',(b:any)=>{b.worker.workerVersion='20000000-0000-4000-8000-000000000001';b.workerVersion=b.worker.workerVersion},'WORKER_PROOF_INVALID'],
    ['proof',(b:any)=>{b.worker.signature='0'.repeat(64)},'WORKER_PROOF_INVALID'],
    ['identity',(b:any)=>{b.bot.credentialUsername='OtroBot'},'RESPONSE_INVALID'],
    ['extra',(b:any)=>{b.bot.secret=cron},'RESPONSE_INVALID'],
    ['expiry',(b:any)=>{b.expiresAt=NOW},'RESPONSE_INVALID'],
    ['username',(b:any)=>{b.bot.expectedUsername='../bad'},'RESPONSE_INVALID'],
  ]as const)('rechaza %s firmado sin exponer campos',async(_name,mutate,code)=>{
    const publicIdentity=vi.fn(),error=await verificaBotDisponibilidad(env(),{now:()=>NOW,publicIdentity,fetch:async(_url:string,o:RequestInit)=>reply(o,mutate)}).catch((e:Error)=>e)
    safeError(error,code);expect(publicIdentity).not.toHaveBeenCalled()
  })
  it('otra versión con prueba válida no confirma el despliegue esperado',async()=>{
    safeError(await verificaBotDisponibilidad(env(),{now:()=>NOW,expectedVersion:'20000000-0000-4000-8000-000000000001',fetch:async(_url:string,o:RequestInit)=>reply(o)}).catch((e:Error)=>e),'WORKER_PROOF_INVALID')
  })
  it.each(['wrong-key','json','duplicate','oversize','type'])('respuesta %s rechazada',async mode=>{
    const fetcher=async(_url:string,o:RequestInit)=>{
      if(mode==='wrong-key')return reply(o,undefined,'c'.repeat(64))
      if(mode==='json')return reply(o,undefined,undefined,cron)
      if(mode==='duplicate')return reply(o,undefined,undefined,'{"schema":1,"schema":1}')
      if(mode==='oversize')return new Response(' '.repeat(4097),{headers:{'Content-Type':'application/json'}})
      return new Response('{}',{headers:{'Content-Type':'text/plain'}})
    }
    safeError(await verificaBotDisponibilidad(env(),{now:()=>NOW,fetch:fetcher}).catch((e:Error)=>e),mode==='wrong-key'?'SIGNATURE_INVALID':'RESPONSE_INVALID')
  })
  it.each([400,401,403,409,429,503,302,418])('HTTP%s clasificado y pausa sin actualizar clave',async status=>{
    const fetcher=vi.fn(async()=>new Response(cron,{status,headers:{location:'https://example.invalid/'+cron}})),code=status===302?'REDIRECT':status===418?'HTTP_OTHER':'HTTP_'+status
    safeError(await verificaBotDisponibilidad(env(),{fetch:fetcher}).catch((e:Error)=>e),code)
    const io=fixture(true);expect(await deployDisponibilidad(env(),{...io,bot:undefined,fetch:fetcher})).toMatchObject({enabled:false,state:'degraded',reason:'GATEWAY_'+code})
    expect(io.calls.map(c=>c.args[1])).toEqual(['deploy'])
  })
  it('red y causa externa cerradas; deploy no propaga callback público accidental',async()=>{
    const io=fixture(true),publicIdentity=vi.fn(),fetcher=async()=>{throw Object.assign(Error(cron,{cause:bot}),{code:cron})}
    safeError(await verificaBotDisponibilidad(env(),{fetch:fetcher}).catch((e:Error)=>e),'NETWORK')
    expect(await deployDisponibilidad(env(),{...io,bot:undefined,fetch:fetcher,publicIdentity})).toMatchObject({state:'degraded',reason:'GATEWAY_NETWORK'})
    expect(publicIdentity).not.toHaveBeenCalled()
  })
  it('timeout acotado sin reintento ni mensaje externo',async()=>{
    const fetcher=vi.fn((_url:string,o:RequestInit)=>new Promise<Response>((_resolve,reject)=>{o.signal!.addEventListener('abort',()=>reject(Error(cron)),{once:true})}))
    safeError(await verificaBotDisponibilidad(env(),{fetch:fetcher,timeoutMs:20}).catch((e:Error)=>e),'TIMEOUT');expect(fetcher).toHaveBeenCalledOnce()
  })
})
describe('Salud efectiva sin objetos de usuario',()=>{
  it('inventario distingue ausencia, error e incompletitud',async()=>{
    for(const present of [false,true])expect(await disponibilidadExiste(env(),async()=>Response.json({success:true,result:present?[{id:'espana-util-disponibilidad'}]:[]}))).toBe(present)
    for(const response of [new Response(null,{status:403}),Response.json({success:false}),Response.json({success:true,result:[],result_info:{total_pages:2}})])await expect(disponibilidadExiste(env(),async()=>response)).rejects.toThrow()
  })
  it('redirección no se sigue y versión debe ser única al100%',async()=>{
    const fetcher=vi.fn(async(_url:string,_init:RequestInit)=>new Response(null,{status:302,headers:{location:'https://example.invalid/'}}))
    await expect(disponibilidadExiste(env(),fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:'manual'})
    const result=(percentage=100)=>({success:true,result:{deployments:[{created_on:'2026-11-21T10:00:00Z',versions:[{version_id:versionId,percentage}]}]}})
    expect(await disponibilidadVersion(env(),async()=>Response.json(result()))).toBe(versionId);await expect(disponibilidadVersion(env(),async()=>Response.json(result(50)))).rejects.toThrow()
  })
  it.each(['true','false'])('tras Pages confirma estado%s, versión y prueba',async enabled=>{
    const fetcher=vi.fn(async()=>Response.json({serviceVersion:versionId,manageAvailable:true,serviceEnabled:enabled==='true',available:enabled==='true'})),check=vi.fn(async(..._args:any[])=>true)
    expect(await verificaDisponibilidad(env(enabled),versionId,{fetch:fetcher,bot:check,sleep:vi.fn()})).toMatchObject({versionId,enabled:enabled==='true',state:enabled==='true'?'ready':'paused'})
    expect(fetcher).toHaveBeenCalledOnce();expect(check).toHaveBeenCalledExactlyOnceWith(env(enabled),{fetch:fetcher,expectedVersion:versionId})
  })
  it('degradado exige pausa real y gestión sin fingir conexión verificada',async()=>{
    const check=vi.fn(),fetcher=vi.fn(async()=>Response.json({serviceVersion:versionId,manageAvailable:true,serviceEnabled:false,available:false}))
    expect(await verificaDisponibilidad({...env('false'),DISPONIBILIDAD_STATE:'degraded'},versionId,{fetch:fetcher,bot:check})).toMatchObject({enabled:false,state:'degraded'})
    expect(check).not.toHaveBeenCalled()
    for(const data of [{serviceVersion:versionId,manageAvailable:true,serviceEnabled:true,available:false},{serviceVersion:'otra',manageAvailable:true,serviceEnabled:false,available:false},{serviceVersion:versionId,manageAvailable:false,serviceEnabled:false,available:false},{serviceVersion:versionId,manageAvailable:true,serviceEnabled:true,available:true}]){
      await expect(verificaDisponibilidad({...env('false'),DISPONIBILIDAD_STATE:'degraded'},versionId,{fetch:async()=>Response.json(data),bot:check,sleep:vi.fn()})).rejects.toThrow()
    }
  })
  it('pausado sin prueba devuelve degraded y permite el resto de datos',async()=>{
    const fetcher=vi.fn(async()=>Response.json({serviceVersion:versionId,manageAvailable:true,serviceEnabled:false,available:false})),check=vi.fn(async()=>{throw Object.assign(Error(cron),{code:'GATEWAY_WORKER_PROOF_INVALID'})})
    expect(await verificaDisponibilidad(env('false'),versionId,{fetch:fetcher,bot:check})).toMatchObject({enabled:false,state:'degraded',reason:'GATEWAY_WORKER_PROOF_INVALID'})
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
describe('CLI y aislamiento de CI',()=>{
  it.each(['match','unauthorized','proof'])('CLI%s no instala ni publica con env accidental',mode=>{
    const require=createRequire(import.meta.url),{spawnSync}=require('node:child_process'),runtime=require('node:process'),helperUrl=new URL('../scripts/lib/disponibilidad-gateway.mjs',import.meta.url).href
    const preload=`
      import * as g from ${JSON.stringify(helperUrl)};let calls=0;
      globalThis.fetch=async(url,o)=>{
        if(++calls!==1||url!==g.GATEWAY_ORIGIN+g.GATEWAY_PATH_CHECK||o.method!=='POST')throw Error('Origen no previsto');
        if(${JSON.stringify(mode)}==='unauthorized')return new Response(process.env.CRON_TOKEN,{status:401});
        const key=await g.derivaGatewayKey(process.env.CRON_TOKEN),req=JSON.parse(o.body);
        const worker=await g.gatewayChallenge(key,{nonce:req.nonce,issuedAt:req.issuedAt,expiresAt:req.expiresAt},'${versionId}');
        if(${JSON.stringify(mode)}==='proof')worker.signature='0'.repeat(64);
        const body={...req,requestDigest:await g.gatewayDigest(o.body),workerVersion:'${versionId}',revision:g.GATEWAY_REVISION,ok:true,bot:{expectedUsername:'GasolinerasAlertasBot',credentialUsername:'GasolinerasAlertasBot'},worker};
        const raw=g.gatewayCanonico(body);return new Response(raw,{headers:{'Content-Type':'application/json',[g.GATEWAY_SIGNATURE_HEADER]:await g.gatewayFirma(key,g.GATEWAY_PATH_CHECK,raw,'response')}});
      };process.on('exit',()=>{if(calls!==1)process.exitCode=90;});`
    const result=spawnSync(runtime.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'scripts/deploy-disponibilidad.mjs','--check-bot'],{cwd:runtime.cwd(),encoding:'utf8',timeout:10000,env:{...env(),SystemRoot:runtime.env.SystemRoot}})
    expect(result.error).toBeUndefined();expect(result.status).toBe(mode==='match'?0:1)
    const rows=result.stdout.trim()?result.stdout.trim().split(/\r?\n/).map((line:string)=>JSON.parse(line)):[]
    expect(rows).toEqual(mode==='match'?[{event:'public-bot-identity',expectedUsername:'GasolinerasAlertasBot',credentialUsername:'GasolinerasAlertasBot'},{event:'disponibilidad-bot-check',ok:true}]:[])
    for(const value of [cron,bot,'api.telegram.org','wrangler','cloudflare.com'])expect(result.stdout+result.stderr).not.toContain(value)
    if(mode!=='match')expect(result.stderr).toContain(mode==='proof'?'GATEWAY_WORKER_PROOF_INVALID':'GATEWAY_HTTP_401')
  })
  it('manual sólo recibe CRON con checkoutmain exacto y lectura',()=>{
    const yaml=createRequire(import.meta.url)('js-yaml'),raw=readFileSync('.github/workflows/check-disponibilidad-bot.yml','utf8'),w=yaml.load(raw)
    expect(Object.keys(w.on)).toEqual(['workflow_dispatch']);expect(w.permissions).toEqual({contents:'read'})
    expect(w.jobs.check.if).toBe("github.repository == 'ioritzarroyuelos-ai/gasolineras-espana' && github.ref == 'refs/heads/main'")
    const steps=w.jobs.check.steps,commands=steps.filter((s:any)=>s.run)
    expect(steps[0].with).toMatchObject({ref:'${{ github.sha }}','persist-credentials':false});expect(commands).toHaveLength(2);expect(commands[0].run).toContain('git rev-parse HEAD')
    expect(commands[1]).toMatchObject({env:{CRON_TOKEN:'${{ secrets.CRON_TOKEN }}'},run:'node scripts/deploy-disponibilidad.mjs --check-bot'})
    expect(raw.match(/secrets\.[A-Z_]+/g)).toEqual(['secrets.CRON_TOKEN']);expect(raw).not.toMatch(/CLOUDFLARE_|GH_TOKEN|GITHUB_TOKEN|DISPONIBILIDAD_ENABLED|wrangler|sendMessage/)
  })
  it('preview sin binding, CRON, gateway ni bot conserva el resto de bindings',()=>{
    const p=config('wrangler.jsonc'),w=config('wrangler.disponibilidad.jsonc')
    expect(p.services).toEqual([]);expect(p.env.preview.services).toEqual([])
    expect(p.env.preview.vars).toMatchObject({DISPONIBILIDAD_ENABLED:'false',CRON_TOKEN:'',DISPONIBILIDAD_GATEWAY_KEY:'',TELEGRAM_BOT_TOKEN:'',TELEGRAM_WEBHOOK_SECRET:''})
    expect(p.env.production.services).toEqual([{binding:'DISPONIBILIDAD',service:'espana-util-disponibilidad'}])
    for(const scope of [p.env.preview,p.env.production]){expect(scope.kv_namespaces).toEqual(p.kv_namespaces);expect(scope.d1_databases).toEqual(p.d1_databases);expect(scope.vars.PUBLIC_ORIGIN).toBe(p.vars.PUBLIC_ORIGIN);expect(scope.vars.GOOGLE_CLIENT_ID).toBe(p.vars.GOOGLE_CLIENT_ID)}
    expect(w.workers_dev).toBe(false);expect(w.preview_urls).toBe(false);expect(w.observability.traces.enabled).toBe(false)
  })
  it('CI conserva gates y salud usa enabled efectivo',()=>{
    const yaml=createRequire(import.meta.url)('js-yaml'),steps=yaml.load(readFileSync('.github/workflows/deploy.yml','utf8')).jobs.deploy.steps,at=(t:string)=>steps.findIndex((s:any)=>s.run?.includes(t))
    expect(at('npm ci --ignore-scripts')).toBeLessThan(at('deploy-disponibilidad.mjs'));expect(at('deploy-disponibilidad.mjs')).toBeLessThan(at('wrangler pages deploy'));expect(at('wrangler pages deploy')).toBeLessThan(at('deploy-disponibilidad.mjs --verify'))
    expect(steps[at('wrangler pages deploy')-1].name).toBe('Confirmar que main no avanzó durante la preparación')
    expect(steps[at('deploy-disponibilidad.mjs --verify')].env).toMatchObject({DISPONIBILIDAD_ENABLED:'${{ steps.disponibilidad.outputs.enabled }}',DISPONIBILIDAD_STATE:'${{ steps.disponibilidad.outputs.state }}'})
    expect(steps[at('deploy-disponibilidad.mjs')].env).not.toHaveProperty('TELEGRAM_BOT_TOKEN')
    expect(readFileSync('.github/workflows/deploy-preview.yml','utf8')).not.toMatch(/deploy-disponibilidad|wrangler\.disponibilidad|new_sqlite_classes/)
  })
})
