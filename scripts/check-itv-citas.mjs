#!/usr/bin/env node
// Sólo lee el formulario público: no envía matrículas ni solicita ninguna cita.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {actualizaOperadoresItv} from './lib/itv-operadores.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const estaciones=JSON.parse(readFileSync(resolve(root,'public/data/itv.json'),'utf8')).estaciones.filter(e=>e.op==='ITVASA' && e.prov==='33')
if (!estaciones.length) throw Error('No se encuentran estaciones oficiales de ITVASA para verificar')
const {perfiles}=await actualizaOperadoresItv(estaciones)
const directory=resolve(process.env.ITV_OUT_DIR || resolve(root,'.tmp/itv-verificacion'))
mkdirSync(directory,{recursive:true})
writeFileSync(resolve(directory,'itv-citas-verificacion.json'),JSON.stringify({checkedAt:new Date().toISOString(),estaciones:estaciones.length,perfiles}))
const perfil=perfiles.itvasa
console.log('ITVASA: '+perfil.estado+(perfil.via?' ('+perfil.via+')':'')+(perfil.error?' — '+perfil.error:''))
if (perfil.estado!=='actualizada') process.exitCode=1
