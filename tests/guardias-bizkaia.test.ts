import { describe, expect, it } from 'vitest'
import { parseGuardiasBizkaia } from '../scripts/lib/guardias-bizkaia.mjs'

const navarro = ['DURANGO', 'NAVARRO ARANDA, Mª JESUS', '94 6810223', 'Artecalle, nº 6']
const bermeo = ['BERMEO', 'APARICIO GONZALEZ, AIDA Mª', '94 6187007', 'Askatasuna Bidea, nº 25']
const bilbao = ['BILBAO', 'ROSELLO GUTIÉRREZ, CRISTINA<br/>Horario de urgencia', '944218904', 'Gordóniz, 34']
const fecha = '2026-11-06'

function tabla(horas: string, valores: string[]) {
  const campos = valores.map((v, i) => '<td data-label="' + ['Municipio','Farmacia','Teléfono','Dirección'][i] + '">' + v + '</td>')
  return '<h2> Horario : ' + horas + '</h2><div><table><tbody><tr>' + campos.join('') + '</tr></tbody></table></div>'
}

function pagina(tablas: string, total: number, otroCampo = '') {
  return '<div id="content" class="farmaciasGuardia"><input name="fecha_guardia" value="06/11/2026">' + otroCampo
    + '<div class="horarioComun"><p>Total de farmacias : ' + total + '</p></div>' + tablas + '</div>'
}

describe('COFBi · calendario de guardias por fecha', () => {
  it('aplica el horario de cada tabla a su fila y distingue una noche entera de un turno de 24 horas', () => {
    const html = pagina(tabla('09:00 - 09:00', navarro) + tabla('08:00 - 23:59', bermeo) + tabla('22:00 - 09:00', bilbao), 3)
    const guardias = parseGuardiasBizkaia(html, fecha)
    expect(guardias[0]).toEqual([0, 0, 'NAVARRO ARANDA, Mª JESUS · Artecalle, nº 6', 'DURANGO', '94 6810223', '', '2026-11-06 09:00-2026-11-07 09:00', ''])
    expect(guardias[1][6]).toBe('2026-11-06 08:00-2026-11-06 23:59')
    expect(guardias[2].slice(6)).toEqual(['2026-11-06 22:00-2026-11-07 09:00', 'Horario de urgencia'])
  })

  it('conserva el contacto de guardias sin convertirlo en parte de la dirección', () => {
    const lekeitio = ['LEKEITIO','GOROSTIAGA OMAETXEBARRIA, KOLDO','946843023','Atea, nº 14      Contacto para guardias 946843023']
    const [fila] = parseGuardiasBizkaia(pagina(tabla('09:00 - 09:00', lekeitio), 1), fecha)
    expect(fila[2]).toBe('GOROSTIAGA OMAETXEBARRIA, KOLDO · Atea, nº 14')
    expect(fila[7]).toBe('Contacto para guardias 946843023')
  })

  it('rehúsa listados parciales, directorios ordinarios y respuestas de otro día o municipio', () => {
    const grupo = tabla('09:00 - 09:00', navarro)
    expect(() => parseGuardiasBizkaia(pagina(grupo, 2), fecha)).toThrow(/número de filas/)
    expect(() => parseGuardiasBizkaia(pagina(grupo, 1), '2026-11-07')).toThrow(/fecha/)
    expect(() => parseGuardiasBizkaia('<div class="horarioComun">' + grupo + '</div>', fecha)).toThrow(/fecha/)
    expect(() => parseGuardiasBizkaia(pagina(grupo, 1, '<select><option value="48027" selected>Durango</option></select>'), fecha)).toThrow(/limitado/)
    expect(() => parseGuardiasBizkaia(pagina(tabla('08:30 - 08:30', navarro), 1), fecha)).toThrow(/duración/)
    expect(() => parseGuardiasBizkaia(pagina(tabla('pendiente', navarro), 1), fecha)).toThrow(/franja/)
  })
})
