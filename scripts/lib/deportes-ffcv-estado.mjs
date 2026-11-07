import { parse } from 'node-html-parser';
import { leerFuenteDeportiva } from './deportes.mjs';

const BASE = 'https://ffcv.es/competiciones/';
const HORA = 3600000;
const PRESUPUESTO = 120; // Precaution chosen here; not a claimed federation quota.
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const codigo = v => /^\d+$/.test(String(v)) ? String(v) : null;
const camposCategoria = ['codigo', 'nombre', 'TipoJuego', 'nombre_grupo_categoria', 'visible_clasificacion'];
const camposGrupo = ['codigo', 'nombre', 'ver_clasificacion'];
const limpia = (objeto, campos) => Object.fromEntries(campos.map(c => [c, String(objeto[c] ?? '')]));

/** Persist only public catalogue/progress metadata, never anonymous session tokens. */
export function normalizaEstadoFFCV(valor) {
  const estado = { version: 1, catalogo: null, cursor: 0, ultimoExito: null, noConsultarAntes: null, ventana: { desde: null, peticiones: 0 }, verificados: {} };
  if (!valor || valor.version !== 1) return estado;
  estado.noConsultarAntes = iso(valor.noConsultarAntes);
  estado.ultimoExito = iso(valor.ultimoExito);
  if (iso(valor.ventana?.desde) && Number.isSafeInteger(valor.ventana.peticiones) && valor.ventana.peticiones >= 0) estado.ventana = { desde: iso(valor.ventana.desde), peticiones: valor.ventana.peticiones };
  const cat = valor.catalogo;
  if (codigo(cat?.temporada?.cod_temporada) && /^20\d{2}-20\d{2}$/.test(cat.temporada.nombre) && iso(cat.verificadoEn) && Array.isArray(cat.categorias) && cat.categorias.length) {
    const categorias = cat.categorias.filter(c => c && codigo(c.codigo) && typeof c.nombre === 'string').map(c => ({ ...limpia(c, camposCategoria), grupos: Array.isArray(c.grupos) ? c.grupos.filter(g => g && codigo(g.codigo) && typeof g.nombre === 'string').map(g => limpia(g, camposGrupo)) : null }));
    const grupos = categorias.flatMap(c => c.grupos || []);
    const gruposValidos = cat.categorias.every(c => c && (!Array.isArray(c.grupos) || c.grupos.every(g => g && codigo(g.codigo) && typeof g.nombre === 'string')));
    if (gruposValidos && categorias.length === cat.categorias.length && new Set(categorias.map(c => c.codigo)).size === categorias.length && new Set(grupos.map(g => g.codigo)).size === grupos.length) {
      estado.catalogo = { temporada: { cod_temporada: String(cat.temporada.cod_temporada), nombre: cat.temporada.nombre }, categorias, verificadoEn: iso(cat.verificadoEn), completo: categorias.every(c => Array.isArray(c.grupos)) };
      estado.cursor = Number.isSafeInteger(valor.cursor) && valor.cursor >= 0 && valor.cursor < grupos.length ? valor.cursor : 0;
      for (const g of grupos) if (iso(valor.verificados?.[g.codigo])) estado.verificados[g.codigo] = iso(valor.verificados[g.codigo]);
    }
  }
  return estado;
}

export function creaEstadoFFCV(categorias, temporada, verificadoEn) {
  const estado = normalizaEstadoFFCV({ version: 1, catalogo: { categorias, temporada, verificadoEn } });
  if (!estado.catalogo) throw new Error('El catálogo valenciano no tiene identidad y fecha verificables.');
  return estado;
}

export function generoFFCV(categoria) {
  const familia = `${categoria.nombre_grupo_categoria || ''} ${categoria.nombre || ''}`;
  if (/MIXT/i.test(familia)) return 'mixto';
  if (/VALENTA|FEMEN/i.test(familia)) return 'femenino';
  if (/MASCUL/i.test(familia)) return 'masculino';
  return undefined;
}

export function creaConsultaFFCV(opciones) {
  const estado = normalizaEstadoFFCV(opciones.estadoFFCV);
  const reloj = opciones.relojFFCV || Date.now;
  const duerme = opciones.duermeFFCV || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const fetcher = opciones.fetcher || fetch;
  let siguiente = 0, detenido = false, cookie = '', token = '';
  const guardar = async () => { await opciones.guardarEstadoFFCV?.(normalizaEstadoFFCV(estado)); };
  const restantes = () => {
    if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) return PRESUPUESTO;
    return Math.max(0, PRESUPUESTO - estado.ventana.peticiones);
  };
  const disponible = () => !detenido && (!estado.noConsultarAntes || reloj() >= Date.parse(estado.noConsultarAntes)) && restantes() > 0;
  const pausaPresupuesto = async () => {
    estado.noConsultarAntes = new Date(Math.max(Date.parse(estado.ventana.desde) + HORA, Date.parse(estado.noConsultarAntes || '') || 0)).toISOString();
    detenido = true;
    await guardar();
  };
  const consulta = async (url, init) => {
    if (!disponible()) throw new Error('Consulta valenciana aplazada para respetar el descanso y el presupuesto persistidos.');
    const espera = siguiente - reloj();
    if (espera > 0) await duerme(espera);
    if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) estado.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 };
    estado.ventana.peticiones++;
    estado.noConsultarAntes = null;
    siguiente = reloj() + 1000;
    await guardar(); // An interrupted job still consumes its request reservation.
    const respuesta = await fetcher(url, { ...init, signal: AbortSignal.timeout(30000), headers: { ...init.headers, ...(token ? { 'X-FFCV-Page-Token': token, Cookie: cookie, Referer: BASE } : {}) } });
    if (respuesta.status === 429) {
      const valor = respuesta.headers.get('Retry-After');
      const segundos = /^\d+$/.test(valor || '') ? Number(valor) : iso(valor) ? Math.max(0, (Date.parse(valor) - reloj()) / 1000) : 3600;
      estado.noConsultarAntes = new Date(reloj() + Math.max(1, segundos) * 1000).toISOString();
      detenido = true;
      await guardar();
      await respuesta.body?.cancel();
      throw new Error(`La federación solicita esperar ${Math.ceil(segundos)} segundos. No se volverá a consultar antes de ${estado.noConsultarAntes}.`);
    }
    if (!token) cookie = (respuesta.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    return respuesta;
  };
  const iniciar = async () => {
    const pagina = await leerFuenteDeportiva(BASE, { ...opciones, fetcher: consulta });
    token = parse(pagina).querySelector('meta[name=ffcv-pt]')?.getAttribute('content');
    if (!token || !cookie) throw new Error('La federación valenciana no ha entregado una sesión pública de consulta.');
  };
  const leer = async ruta => {
    const datos = JSON.parse(await leerFuenteDeportiva(BASE + ruta, { ...opciones, fetcher: consulta }));
    if (datos.error || datos.estado === '0' || datos.sesion_ok === '0') throw new Error('La federación valenciana no ha podido completar la consulta pública.');
    return datos;
  };
  return { estado, guardar, restantes, disponible, pausaPresupuesto, iniciar, leer };
}
