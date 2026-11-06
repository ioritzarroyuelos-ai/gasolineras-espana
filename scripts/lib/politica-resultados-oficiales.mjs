// Repartos definitivos de la Junta Electoral Central, ligados a su elección.
// Una encuesta nueva no puede cambiar el resultado de una votación pasada.
const BOE = 'https://www.boe.es/diario_boe/txt.php?id='

function reparto(fecha, documento, filas) {
  return {
    candidaturas: filas.map(([id, siglas, nombre]) => ({ id, siglas, nombre })),
    referencia: {
      fecha,
      fuente: 'Junta Electoral Central (BOE)',
      url: BOE + documento,
      escanos: filas.map(([candidaturaId, , , escanos]) => ({ candidaturaId, escanos })),
    },
  }
}

// Cuadro II, totales estatales de las dos tablas de candidaturas con escaño.
const europeas2024 = reparto('2024-06-09', 'BOE-A-2024-13092', [
  ['pp', 'PP', 'Partido Popular', 22],
  ['psoe', 'PSOE', 'Partido Socialista Obrero Español', 20],
  ['vox', 'Vox', 'Vox', 6],
  ['ahorarepublicas', 'Ahora Repúblicas', 'Ahora Repúblicas (ERC, EH Bildu, BNG y Ara Més)', 3],
  ['sumar', 'Sumar', 'Sumar', 3],
  ['salf', 'SALF', 'Se Acabó la Fiesta', 3],
  ['podemos', 'Podemos', 'Podemos', 2],
  ['junts', 'Junts UE', 'Junts i Lliures per Europa', 1],
  ['ceus', 'CEUS', 'Coalición por una Europa Solidaria', 1],
])

// BOE, páginas 122238–122246. Se cuentan los proclamados por circunscripción.
// Las listas territoriales socialistas suman 72 (incluidos 12 del PSC).
const senado2023 = {
  electivos: 208,
  ...reparto('2023-07-23', 'BOE-A-2023-18907', [
    ['pp', 'PP', 'Partido Popular', 120],
    ['psoe', 'PSOE (incluido PSC)', 'PSOE y candidaturas territoriales, incluido el PSC', 72],
    ['ehbildu', 'EH Bildu', 'Euskal Herria Bildu', 4],
    ['pnv', 'EAJ-PNV', 'Euzko Alderdi Jeltzalea – Partido Nacionalista Vasco', 4],
    ['erc', 'ERC', 'Esquerra Republicana de Catalunya – Esquerres per la Independència', 3],
    ['junts', 'Junts', 'Junts per Catalunya', 1],
    ['upn', 'UPN', 'Unión del Pueblo Navarro', 1],
    ['asg', 'ASG', 'Agrupación Socialista Gomera', 1],
    ['ahi', 'AHI', 'Agrupación Herreña Independiente', 1],
    ['eivissaformentera', 'Eivissa i Formentera al Senat', 'Eivissa i Formentera al Senat', 1],
  ]),
}

export function completaResultadosOficiales(file) {
  if (file.id === 'generales' && file.referencia.fecha === senado2023.referencia.fecha && !file.senado) {
    return { ...file, senado: senado2023 }
  }
  if (file.id === 'europeas' && file.referencia.fecha === europeas2024.referencia.fecha) {
    const candidaturas = new Map(file.candidaturas.map(c => [c.id, c]))
    for (const c of europeas2024.candidaturas) if (!candidaturas.has(c.id)) candidaturas.set(c.id, c)
    return { ...file, referencia: europeas2024.referencia, candidaturas: [...candidaturas.values()] }
  }
  return file
}
