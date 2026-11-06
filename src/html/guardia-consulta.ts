import { escapeHtml as esc } from './html'
import { envoltorioIndice } from './guardia-municipio'
import type { ProvinciaEntry } from '../lib/provincias'
import { fuenteGuardia, type GuardiasFile } from '../lib/guardias'

export interface LugarGuardia { nombre: string; provincia: string; ruta: string }

export function paginaSinTurno(nonce: string, canonical: string, provincia: ProvinciaEntry, municipio?: string, datos?: GuardiasFile | null, temporal = false): string {
  const lugar = municipio || provincia.name
  const titulo = 'Farmacias de guardia en ' + lugar
  const fuente = fuenteGuardia(provincia.slug, datos ?? undefined)
  const enlace = fuente || 'https://www.farmaceuticos.com/farmacias-de-guardia/'
  const accion = fuente ? 'Consultar las guardias en la fuente oficial' : 'Buscar el colegio farmacéutico de la provincia'
  const mensaje = temporal ? 'Ahora no podemos comprobar los turnos de ' : 'Hoy no tenemos un turno confirmado en '
  const cuerpo = '<h1>' + esc(titulo) + '</h1><p>' + mensaje + esc(lugar) + '.</p>'
    + '<p><a class="btn" href="' + esc(enlace) + '">' + accion + '</a></p>'
    + (municipio && provincia.slug !== 'lugo' ? '<p><a href="/farmacias/' + esc(provincia.slug) + '">Ver los turnos de la provincia de ' + esc(provincia.name) + '</a></p>' : '')
    + '<p><a href="/farmacias/">Buscar otro municipio</a></p>'
  return envoltorioIndice(nonce, titulo, 'Consulta las guardias en la fuente oficial de ' + lugar + '.', canonical, cuerpo, true)
}

export function paginaBusquedaGuardia(nonce: string, canonical: string, consulta: string, lugares: LugarGuardia[], disponible: boolean): string {
  const titulo = 'Buscar una farmacia de guardia'
  const mensaje = disponible ? 'No encontramos ese nombre. Prueba con la localidad o consulta la provincia.' : 'Ahora no podemos cargar el listado. Puedes volver a buscar o consultar la provincia.'
  const cuerpo = '<h1>' + titulo + '</h1><form action="/farmacias/buscar" method="get">'
    + '<label for="municipio">Municipio o provincia</label> <input id="municipio" name="q" type="search" maxlength="80" required value="' + esc(consulta) + '"> <button class="btn">Buscar</button></form>'
    + (lugares.length ? '<nav class="lista" aria-label="Resultados"><h2>Elige tu localidad o provincia</h2><ul>' + lugares.map(l =>
      '<li><a href="' + esc(l.ruta) + '">' + esc(l.nombre) + ' · ' + esc(l.provincia) + '</a></li>').join('') + '</ul></nav>' : '<p>' + mensaje + '</p>')
    + '<p><a href="/farmacias/guardia">Consultar por provincia</a></p>'
  return envoltorioIndice(nonce, titulo, titulo, canonical, cuerpo, true)
}
