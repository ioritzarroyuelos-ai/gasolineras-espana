// Repartos definitivos de la Junta Electoral Central, ligados a su elección.
// Una encuesta nueva no puede cambiar el resultado de una votación pasada.
const BOE = 'https://www.boe.es/diario_boe/txt.php?id='

function reparto(fecha, documento, filas, fuente = 'Junta Electoral Central (BOE)') {
  return {
    candidaturas: filas.map(([id, siglas, nombre]) => ({ id, siglas, nombre })),
    referencia: {
      fecha,
      fuente,
      url: documento.startsWith('https://') ? documento : BOE + documento,
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

// Resultados definitivos: BOA 25-02-2026, cuadro II (páginas 4–5);
// BOCYL 29-04-2026, anexo II; DOE 14-01-2026, páginas 1912–1913.
// Se vinculan a la fecha exacta: no se trasladan a una elección posterior.
const autonomicas = {
  aragon: reparto('2026-02-08', 'https://www.boa.aragon.es/cgi-bin/EBOA/BRSCGI?CMD=VEROBJ&MLKOB=1437358090606', [
    ['pp', 'PP', 'Partido Popular', 26],
    ['psoe', 'PSOE', 'Partido Socialista Obrero Español', 18],
    ['vox', 'Vox', 'Vox', 14],
    ['cha', 'CHA', 'Chunta Aragonesista', 6],
    ['existe', 'Aragón Existe', 'Aragón Existe / Coalición Existe', 2],
    ['iusumar', 'IU-Sumar', 'Izquierda Unida-Movimiento Sumar', 1],
  ], 'Junta Electoral de Aragón (BOA)'),
  'castilla-y-leon': reparto('2026-03-15', 'https://bocyl.jcyl.es/boletines/2026/04/29/pdf/BOCYL-D-29042026-80-13.pdf', [
    ['pp', 'PP', 'Partido Popular', 33],
    ['psoe', 'PSOE', 'Partido Socialista Obrero Español', 30],
    ['vox', 'Vox', 'Vox', 14],
    ['upl', 'UPL', 'Unión del Pueblo Leonés', 3],
    ['xav', 'Por Ávila', 'Por Ávila', 1],
    ['sy', 'Soria ¡Ya!', 'Soria ¡Ya!', 1],
  ], 'Junta Electoral de Castilla y León (BOCYL)'),
  extremadura: reparto('2025-12-21', 'https://www.juntaelectoralcentral.es/cs/jec/documentos/extremadura_2025_resultados.pdf', [
    ['pp', 'PP', 'Partido Popular', 29],
    ['psoe', 'PSOE', 'Partido Socialista Obrero Español', 18],
    ['vox', 'Vox', 'Vox', 11],
    ['unidasporextremadura', 'Unidas por Extremadura', 'Unidas por Extremadura Podemos Izquierda Unida Alianza Verde', 7],
  ], 'Junta Electoral de Extremadura (DOE)'),
}

export function completaResultadosOficiales(file) {
  if (file.id === 'generales' && file.referencia.fecha === senado2023.referencia.fecha && !file.senado) {
    return { ...file, senado: senado2023 }
  }
  const resultado = file.id === 'europeas' ? europeas2024 : autonomicas[file.id]
  if (resultado && file.referencia.fecha === resultado.referencia.fecha) {
    const candidaturas = new Map(file.candidaturas.map(c => [c.id, c]))
    for (const c of resultado.candidaturas) if (!candidaturas.has(c.id)) candidaturas.set(c.id, c)
    return { ...file, referencia: resultado.referencia, candidaturas: [...candidaturas.values()] }
  }
  return file
}
