import type {Hono} from 'hono'
import type {Env} from '../index'
import {canonicalBase,genNonce} from '../lib/runtime'
import {landingHeaders} from '../html/landing'
import {buildServiciosMunicipales} from '../html/servicios-municipales'
import {cargaCatalogoMunicipal,cargaProvinciaMunicipal,cargaResumenMunicipal} from '../lib/servicios-municipales'

export function registerServiciosMunicipalesRoutes(app:Hono<{Bindings:Env}>){
  // Primera entrega: todas las páginas son consultables pero no indexables.
  // La retirada requiere una revisión publicada de CPU/preview y contenido.
  const page=(nonce:string,canonical:string,data:Omit<Parameters<typeof buildServiciosMunicipales>[0],'nonce'|'canonical'>,status=200)=>new Response(buildServiciosMunicipales({nonce,canonical,...data}),{status,headers:{...landingHeaders(nonce),'X-Robots-Tag':'noindex, follow'}})
  app.get('/servicios/municipios/',c=>c.redirect('/servicios/municipios',301))
  app.get('/servicios/municipios',async c=>{
    const nonce=genNonce(),canonical=canonicalBase(c)+'/servicios/municipios'
    try{return page(nonce,canonical,{catalogo:await cargaCatalogoMunicipal(c.env.ASSETS)})}catch{return page(nonce,canonical,{error:'temporal'},503)}
  })
  app.get('/servicios/municipios/:provincia',async c=>{
    const provincia=c.req.param('provincia'),raw=c.req.query('pagina')||'0',nonce=genNonce(),canonical=canonicalBase(c)+'/servicios/municipios/'+encodeURIComponent(provincia)
    if(!/^\d{2}$/.test(provincia)||! /^(0|[1-9]\d{0,2})$/.test(raw))return page(nonce,canonical,{error:'sin_ficha'},404)
    try{const data=await cargaProvinciaMunicipal(c.env.ASSETS,provincia),pagina=Number(raw);if(!data||pagina*50>=data.indice.centros.length)return page(nonce,canonical,{error:'sin_ficha'},404);return page(nonce,canonical+(pagina?'?pagina='+pagina:''),{...data,pagina})}catch{return page(nonce,canonical,{error:'temporal'},503)}
  })
  app.get('/servicios/municipio/:ine/:slug',async c=>{
    const ine=c.req.param('ine'),nonce=genNonce(),base=canonicalBase(c)
    if(!/^\d{5}$/.test(ine))return page(nonce,base+'/servicios/municipios',{error:'sin_ficha'},404)
    try{const data=await cargaResumenMunicipal(c.env.ASSETS,ine);if(!data)return page(nonce,base+'/servicios/municipios',{error:'sin_ficha'},404);const path='/servicios/municipio/'+ine+'/'+data.resumen.slug;if(c.req.param('slug')!==data.resumen.slug)return c.redirect(path,301);return page(nonce,base+path,data)}catch{return page(nonce,base+'/servicios/municipios',{error:'temporal'},503)}
  })
}
