// Validación multinivel del CANDIDATO (fichero de una elección recién parseado)
// antes de reemplazar el último bueno. Plain JS (corre en el robot, Node). El
// esquema/forma también está en src/lib/politica-schemas.ts (zod) para los tests
// y el contrato; aquí validamos invariantes de datos + regresión (equivalente al
// guard MIN_FILAS de fetch-prices, pero relativo: 0 sondeos puede ser legítimo).

function maxEscanos(esc) {
  if (esc == null) return null
  if (typeof esc === 'number') return esc
  return esc.max
}

/**
 * @param {any} nuevo   fichero de elección candidato (EleccionFile)
 * @param {any|null} anterior  último fichero bueno (o null si no hay)
 * @param {{ enVeda?: boolean }} [opts]
 * @returns {{ ok: boolean, motivo?: string, revision: boolean, diagnostico: object }}
 */
export function validaEleccion(nuevo, anterior, opts = {}) {
  const diagnostico = {
    sondeos: nuevo && Array.isArray(nuevo.sondeos) ? nuevo.sondeos.length : 0,
    anteriores: anterior && Array.isArray(anterior.sondeos) ? anterior.sondeos.length : 0,
    anomalias: 0,
  }

  // Nivel 1 — estructura mínima
  if (!nuevo || !Array.isArray(nuevo.sondeos) || !nuevo.camara || !Number.isFinite(nuevo.camara.escanos)) {
    return { ok: false, motivo: 'estructura inválida', revision: false, diagnostico }
  }
  const cam = nuevo.camara.escanos

  // Nivel 2 — coherencia (rangos y tope de cámara)
  for (const s of nuevo.sondeos) {
    if (!Array.isArray(s.datos)) return { ok: false, motivo: 'sondeo sin datos', revision: false, diagnostico }
    for (const d of s.datos) {
      if (d.pct != null && (typeof d.pct !== 'number' || d.pct < 0 || d.pct > 100)) diagnostico.anomalias++
      const me = maxEscanos(d.escanos)
      if (me != null) {
        if (!Number.isInteger(me) || me < 0) diagnostico.anomalias++
        else if (me > cam) {
          // Un partido no puede sacar más escaños que el tamaño de la cámara.
          return { ok: false, motivo: `escaños (${me}) > cámara (${cam})`, revision: false, diagnostico }
        }
      }
    }
  }
  if (diagnostico.anomalias > 0) {
    return { ok: false, motivo: `${diagnostico.anomalias} valores fuera de rango`, revision: false, diagnostico }
  }

  // Nivel 3 — regresión: no pasar de datos a vacío (salvo veda, que oculta a propósito)
  if (nuevo.sondeos.length === 0 && diagnostico.anteriores > 0 && !opts.enVeda) {
    return { ok: false, motivo: 'de datos a vacío sin veda', revision: false, diagnostico }
  }

  // Nivel 4 — caída fuerte de cobertura: no bloquea, marca revisión
  let revision = false
  if (diagnostico.anteriores > 0 && nuevo.sondeos.length < diagnostico.anteriores * 0.8) {
    revision = true
    diagnostico.caida = +(1 - nuevo.sondeos.length / diagnostico.anteriores).toFixed(2)
  }

  return { ok: true, revision, diagnostico }
}
