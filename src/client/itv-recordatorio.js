import { calendarioItv, fechaItvValida } from '../lib/itv-recordatorio.ts';
import { iniciarItvTelegram } from './itv-telegram.js';

(async () => {
  const form = document.getElementById('itv-recordatorio-form');
  if (!form) return;
  await window.EUCuenta.ready;
  const api = window.EUCuenta.itv;
  const date = document.getElementById('itv-recordatorio-fecha'), name = document.getElementById('itv-recordatorio-nombre');
  const download = document.getElementById('itv-recordatorio-calendario'), remove = document.getElementById('itv-recordatorio-borrar');
  const summary = document.getElementById('itv-recordatorio-resumen'), status = document.getElementById('itv-recordatorio-estado');
  let dirty = false;
  function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
  function draw() {
    const item = api.recordatorio();
    if (!dirty) { date.value = item?.fecha || ''; name.value = item?.nombre || ''; }
    download.hidden = remove.hidden = !item; download.disabled = dirty;
    summary.textContent = item ? item.nombre + ' · Fecha que indicaste: ' + new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(item.fecha + 'T12:00:00Z')) + '.' : 'Todavía no has guardado una fecha.';
    if (!dirty) message(!item ? '' : !window.EUCuenta.user ? 'Guardado en este navegador.' : window.EUCuenta.status === 'saved' ? 'Guardado en tu cuenta.' : 'Guardado en este navegador. La sincronización con tu cuenta está pendiente.');
    window.dispatchEvent(new CustomEvent('eu:itv-fecha'));
  }
  form.addEventListener('input', () => { dirty = true; download.disabled = true; message('Guarda los cambios antes de descargar el calendario.'); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || !fechaItvValida(date.value)) { message('Revisa la fecha que has escrito.', true); return; }
    try { await api.guardarRecordatorio({ fecha: date.value, nombre: name.value }); dirty = false; draw(); }
    catch (error) { message(error.message || 'No se pudo guardar la fecha.', true); }
  });
  download.addEventListener('click', () => {
    try {
      const item = api.recordatorio(); if (!item || dirty) return;
      const url = URL.createObjectURL(new Blob([calendarioItv(item)], { type: 'text/calendar;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'recordatorio-itv.ics'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message('Archivo descargado. Impórtalo en tu calendario y comprueba que los avisos estén activados.');
    } catch { message('No se pudo preparar el calendario. Vuelve a intentarlo.', true); }
  });
  remove.addEventListener('click', async () => {
    if (!window.confirm('¿Quitar esta fecha de España Útil? El evento que hayas importado se elimina en tu propio calendario.')) return;
    try { await api.borrarRecordatorio(); dirty = false; draw(); message('Recordatorio quitado de esta página. Si lo importaste, elimínalo también de tu calendario.'); }
    catch { message('No se pudo quitar el recordatorio. Vuelve a intentarlo.', true); }
  });
  window.addEventListener('eu:cuenta', event => {
    if (event.detail?.reason === 'account') dirty = false;
    if (['account', 'pull', 'import', 'ready', 'saved', 'status'].includes(event.detail?.reason) || event.detail?.keys?.includes('eu-itv-recordatorio-v1')) draw();
  });
  window.addEventListener('storage', event => { if (event.key === 'eu-itv-recordatorio-v1' || event.key === null) draw(); });
  document.getElementById('itv-recordatorio-controles').hidden = false;
  draw();
  void iniciarItvTelegram(api, () => dirty);
})();
