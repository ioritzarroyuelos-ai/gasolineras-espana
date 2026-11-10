#!/usr/bin/env node
// Node 22.18+: TypeScript nativo, sin servicios ni dependencias adicionales.
import {mkdirSync,writeFileSync,renameSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {TARIFAS,TASA_DGT_FUENTE,desglosa,tarifaVigente} from '../src/lib/itv-tarifas.ts'
import {COMPROBACIONES_TARIFAS,compruebaFuenteTarifa} from './lib/itv-tarifas-check.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)),'..')
const directory = resolve(process.env.ITV_OUT_DIR || resolve(root,'public/data'))
const ahora = new Date()
const comparables = TARIFAS.filter(t=>t.estado==='verificada')
const definiciones = comparables.map(t=>({id:t.slug,url:t.fuenteUrl}))
definiciones.push({id:'tasa-dgt',url:TASA_DGT_FUENTE}, {id:'tasa-clm',url:TARIFAS.find(t=>t.slug==='castilla-la-mancha').suplementos[0].fuenteUrl})
const fuentes = []
for (let i=0;i<definiciones.length;i+=3) fuentes.push(...await Promise.all(definiciones.slice(i,i+3).map(f=>compruebaFuenteTarifa(f,ahora))))
const tarifas = comparables.map(t=>{
  const ids = [t.slug,'tasa-dgt',...(t.slug==='castilla-la-mancha'?['tasa-clm']:[])]
  const spec = COMPROBACIONES_TARIFAS[t.slug]
  const importesCoinciden = spec && ['gasolina','diesel'].every((fuel,i)=>Math.abs(desglosa(t,t[fuel]).total-spec.total[i])<0.001)
  return {slug:t.slug,estado:tarifaVigente(t,ahora.getTime()) && importesCoinciden && ids.every(id=>fuentes.find(f=>f.id===id)?.estado==='verificada')?'verificada':'pendiente',fuentes:ids}
})
const estado = tarifas.every(t=>t.estado==='verificada')?'verificada':'pendiente'
const payload = {v:1,checkedAt:ahora.toISOString(),estado,fuentes,tarifas}
mkdirSync(directory,{recursive:true})
const path = resolve(directory,'itv-tarifas-estado.json')
writeFileSync(path+'.tmp',JSON.stringify(payload)); renameSync(path+'.tmp',path)
for (const f of fuentes) console.log(f.id+': '+f.estado+(f.error?' — '+f.error:''))
console.log('Tarifas comprobadas: '+tarifas.filter(t=>t.estado==='verificada').length+'/'+tarifas.length)
if (estado!=='verificada') process.exitCode=1
