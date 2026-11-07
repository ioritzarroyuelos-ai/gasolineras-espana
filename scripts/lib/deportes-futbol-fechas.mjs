/** Horas peninsulares de las competiciones nacionales publicadas por RFEF. */
export function fechaMadrid(fecha, hora) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null;
  const base = Date.parse(`${fecha}T${hora}:00Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 10) !== fecha) return null;
  const formatea = valor => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(valor));
  // Check both offsets instead of assuming that summer and winter have the same clock.
  for (const horas of [1, 2]) {
    const candidato = base - horas * 3600000;
    if (formatea(candidato) === `${fecha} ${hora}`) return new Date(candidato).toISOString();
  }
  return null;
}

export function fechaEspanola(valor) {
  const m = String(valor ?? '').trim().match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (!m) return null;
  const fecha = `${m[3]}-${m[2]}-${m[1]}`;
  return fechaMadrid(fecha, '12:00') ? fecha : null;
}
