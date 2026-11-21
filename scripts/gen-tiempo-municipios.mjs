#!/usr/bin/env node
// Revisión diaria independiente. Una caída conserva el catálogo válido.
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {actualizaMaestroMunicipios} from './lib/aemet-municipios.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const result=await actualizaMaestroMunicipios({output:resolve(root,'public/data/tiempo/municipios.json'),statusPath:resolve(root,'public/data/tiempo/municipios-estado.json'),key:process.env.AEMET_API_KEY})
console.log(JSON.stringify({estado:result.status.estado,total:result.status.total,ultimoExito:result.status.ultimoExito}))
if(!result.correcto)process.exitCode=1
