#!/usr/bin/env node
// Actualiza cada fuente oficial por separado. Los errores conservan la copia de
// esa fuente con su fecha anterior, mientras las demás pueden seguir avanzando.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FUENTES_ITV, actualizaFuenteItv, combinaFuentesItv, conservaDatosPreviosItv, migraCopiaDgt } from './lib/itv-fuentes.mjs'
import { actualizaOperadoresItv } from './lib/itv-operadores.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = resolve(process.env.ITV_OUT_DIR || resolve(ROOT, 'public/data'))
const ARCHIVO = resolve(DATA_DIR, 'itv.json')
const FUENTES_DIR = resolve(DATA_DIR, 'itv-fuentes')

function leer(path) {
  try { return JSON.parse(readFileSync(path,'utf8')) } catch { return null }
}

function escribir(path, datos) {
  const temporal = path+'.tmp'
  writeFileSync(temporal,JSON.stringify(datos))
  renameSync(temporal,path)
}

async function main() {
  const previo = leer(ARCHIVO) || leer(resolve(ROOT,'public/data/itv.json')) || {}
  const fuentes = await Promise.all(FUENTES_ITV.map(fuente => {
    const anterior = leer(resolve(FUENTES_DIR,fuente.id+'.json'))
      || leer(resolve(ROOT,'public/data/itv-fuentes',fuente.id+'.json'))
      || (fuente.id === 'dgt' ? migraCopiaDgt(previo) : null)
    return actualizaFuenteItv(fuente,anterior)
  }))
  for (const f of fuentes)
    console.log(f.nombre+': '+f.estaciones.length+' estaciones, '+f.estado+(f.error ? ' ('+f.error+')' : '')+(f.publicado ? ', publicación '+f.publicado : ''))
  const fuentesEstado = fuentes.map(({ estaciones, excluidas, ...estado }) => ({ ...estado, total:estaciones.length }))
  if (!fuentes.some(f => f.estado === 'actualizada')) {
    // Publicamos también el fallo; no rejuvenecemos generatedAt ni las fichas.
    mkdirSync(FUENTES_DIR,{recursive:true})
    for (const f of fuentes) escribir(resolve(FUENTES_DIR,f.id+'.json'),f)
    escribir(ARCHIVO,{...previo,fuentesEstado})
    throw Error('Ninguna fuente oficial respondió correctamente. Se conserva el directorio anterior con el aviso del intento fallido.')
  }
  const incidencias = []
  const combinado = combinaFuentesItv(fuentes,incidencias)
  for (const [motivo,filas] of Object.entries(Object.groupBy(incidencias,i=>i.motivo)))
    console.log('Conciliación: '+filas.length+' filas — '+motivo)
  const operadoresPrevios = leer(resolve(FUENTES_DIR,'operadores.json'))
    || leer(resolve(ROOT,'public/data/itv-fuentes/operadores.json')) || {}
  const { estaciones: enriquecidas, perfiles } = await actualizaOperadoresItv(combinado,operadoresPrevios)
  const estaciones = conservaDatosPreviosItv(enriquecidas,previo.estaciones)
  for (const p of Object.values(perfiles))
    console.log(p.nombre+': citas '+p.estado+(p.error ? ' ('+p.error+')' : ''))
  if (estaciones.length < 300) throw Error('La combinación no tiene cobertura nacional suficiente')
  const payload = { v:2, generatedAt:new Date().toISOString(), fuentes:fuentes.map(f=>f.nombre),
    fuentesEstado, incidencias, total:estaciones.length, estaciones }
  mkdirSync(FUENTES_DIR,{recursive:true})
  for (const f of fuentes) escribir(resolve(FUENTES_DIR,f.id+'.json'),f)
  escribir(resolve(FUENTES_DIR,'operadores.json'),perfiles)
  escribir(ARCHIVO,payload)
  console.log('OK: '+estaciones.length+' estaciones en '+new Set(estaciones.map(e=>e.prov)).size+' provincias; '
    +estaciones.filter(e=>e.citaUrl).length+' con cita oficial; '+estaciones.filter(e=>e.lat!==null).length+' con coordenadas.')
  if (fuentes.some(f=>f.estado!=='actualizada') || Object.values(perfiles).some(p=>p.estado!=='actualizada')) {
    console.error('Parte de las fuentes o citas no pudo comprobarse: copia conservada con su fecha anterior.')
    process.exitCode = 1
  }
}
main().catch(e => { console.error('FATAL: '+e.message); process.exitCode = 1 })
