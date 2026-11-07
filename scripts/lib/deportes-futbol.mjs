import { parse } from 'node-html-parser';
import { leerFuenteDeportiva, validaUrlDeportiva } from './deportes.mjs';
import { creaConsultaFFCV, creaEstadoFFCV, generoFFCV } from './deportes-ffcv-estado.mjs';
export { creaEstadoFFCV, normalizaEstadoFFCV, generoFFCV } from './deportes-ffcv-estado.mjs';

const LALIGA = 'https://www.laliga.com';
const FUTSAL = 'https://futsal.rfef.es';
const RFEF = 'https://rfef.es/es/resultados';
const FFCV = 'https://ffcv.es/competiciones/';
const columnas = [
  { clave: 'puntos', nombre: 'Puntos' }, { clave: 'jugados', nombre: 'Jugados' },
  { clave: 'ganados', nombre: 'Ganados' }, { clave: 'empatados', nombre: 'Empatados' },
  { clave: 'perdidos', nombre: 'Perdidos' }, { clave: 'favor', nombre: 'Goles a favor' },
  { clave: 'contra', nombre: 'Goles en contra' },
];
const texto = valor => String(valor ?? '').replace(/\s+/g, ' ').trim();
const numero = valor => /^\d+$/.test(String(valor)) ? Number(valor) : null;
const fechaISO = valor => /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(String(valor)) && Number.isFinite(Date.parse(valor)) ? new Date(valor).toISOString() : null;
const sello = opciones => new Date(opciones.ahora ?? Date.now()).toISOString();
const sinDatos = (url, consultado, campo) => ({ estado: 'no_disponible', consultado, fuenteUrl: url, [campo]: [] });
const incidencia = (nombre, fuenteUrl, motivo, id) => ({ deporte: 'futbol', nombre, fuenteUrl, motivo, ...(id ? { id } : {}) });

function bloque(url, consultado, campo, datos) {
  if (!datos.length) return sinDatos(url, consultado, campo);
  return { estado: 'actualizado', consultado, verificadoEn: consultado, fuenteUrl: url, [campo]: datos };
}

function datosLaLiga(html, esperada) {
  const script = parse(html).querySelector('#__NEXT_DATA__');
  if (!script) throw new Error('LaLiga no ha entregado los datos de la página.');
  const raiz = JSON.parse(script.text);
  const props = raiz.props;
  const datos = props?.pageProps;
  if (datos?.competition !== esperada || !/^20\d{2}$/.test(String(datos.season))) throw new Error('LaLiga ha entregado otra competición o una temporada sin identificar.');
  return { datos, territorio: props.country };
}

/** LaLiga publica horas ISO con zona y estados explícitos; no deducimos resultados del reloj. */
export function parseaAgendaLaLiga(html, esperada, fuenteUrl, verificadoEn) {
  const { datos, territorio } = datosLaLiga(html, esperada);
  if (!Array.isArray(datos.matches) || !datos.matches.length) throw new Error('LaLiga no ha publicado partidos para esta jornada.');
  const estados = { FullTime: 'finalizado', PreMatch: 'programado', FirstHalf: 'en_juego', SecondHalf: 'en_juego', HalfTime: 'en_juego', ExtraTime: 'en_juego', Penalties: 'en_juego', Postponed: 'aplazado', Canceled: 'cancelado', Cancelled: 'cancelado' };
  const eventos = datos.matches.map(partido => {
    const local = texto(partido.home_team?.nickname || partido.home_team?.name);
    const visitante = texto(partido.away_team?.nickname || partido.away_team?.name);
    if (!local || !visitante || !partido.id) throw new Error('Partido de LaLiga incompleto.');
    const estado = estados[partido.status] || 'por_confirmar';
    const inicio = fechaISO(partido.time);
    const resultado = ['finalizado', 'en_juego'].includes(estado) && numero(partido.home_score) !== null && numero(partido.away_score) !== null
      ? { local: Number(partido.home_score), visitante: Number(partido.away_score) } : null;
    if (estado === 'finalizado' && !resultado) throw new Error('LaLiga señala un partido finalizado sin marcador válido.');
    const emisiones = territorio === 'ES' && !['cancelado', 'aplazado'].includes(estado)
      ? (partido.channels || []).filter(c => texto(c.name) && !/^(?:-|replay)$/i.test(texto(c.name))).map(c => ({ nombre: texto(c.name), url: fuenteUrl, fuenteUrl, territorio: 'España', verificadoEn })) : [];
    return { id: `laliga-${partido.id}`, nombre: `${local} — ${visitante}`, local, visitante, inicio, fecha: inicio?.slice(0, 10) || fechaISO(partido.date)?.slice(0, 10) || null, estado, resultado, ...(texto(datos.gameweek?.name) ? { jornada: texto(datos.gameweek.name) } : {}), ...(texto(partido.venue?.name) ? { lugar: texto(partido.venue.name) } : {}), fuenteUrl, emisiones };
  });
  return { temporada: `${datos.season}-${Number(datos.season) + 1}`, eventos, jornadas: datos.gameweekList || [], jornada: datos.gameweek?.week };
}

export function parseaClasificacionLaLiga(html, esperada) {
  const { datos } = datosLaLiga(html, esperada);
  if (!Array.isArray(datos.standings) || !datos.standings.length) throw new Error('LaLiga no ha entregado la clasificación general.');
  const filas = datos.standings.map(fila => {
    const valores = Object.fromEntries([['puntos', 'points'], ['jugados', 'played'], ['ganados', 'won'], ['empatados', 'drawn'], ['perdidos', 'lost'], ['favor', 'goals_for'], ['contra', 'goals_against']].map(([clave, campo]) => {
      const valor = numero(fila[campo]);
      if (valor === null) throw new Error('Clasificación de LaLiga incompleta.');
      return [clave, valor];
    }));
    if (!numero(fila.position) || !texto(fila.team?.nickname || fila.team?.name)) throw new Error('Equipo o posición ausentes en LaLiga.');
    return { posicion: Number(fila.position), nombre: texto(fila.team.nickname || fila.team.name), valores };
  });
  return { temporada: `${datos.season}-${Number(datos.season) + 1}`, tablas: [{ id: 'general', nombre: 'Clasificación general', columnas, filas }] };
}

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

export function descubreFutsal(html) {
  const enlaces = new Map();
  for (const nodo of parse(html).querySelectorAll('a[href]')) {
    const url = new URL(nodo.getAttribute('href'), FUTSAL);
    const partes = url.pathname.match(/^\/competicion\/([^/]+)\/(20\d{2})\/resultados(?:\/(\d+|playoffs))?\/?$/);
    if (url.origin !== FUTSAL || !partes) continue;
    const slug = partes[1] === 'primera' ? 'liga-prime-futsal' : partes[1];
    const grupo = partes[3] || '1';
    const clave = `${slug}-${partes[2]}-${grupo}`;
    enlaces.set(clave, { slug, year: Number(partes[2]), grupo, url: `${FUTSAL}/competicion/${slug}/${partes[2]}/resultados/${grupo}` });
  }
  // A cup's bare URL and /playoffs represent the same elimination stage.
  return [...enlaces.values()].filter(item => item.grupo !== '1' || !enlaces.has(`${item.slug}-${item.year}-playoffs`));
}

export function parseaFichaFutsal(html, esperada) {
  const doc = parse(html);
  const titulo = texto(doc.querySelector('title')?.text);
  const identificador = titulo.match(/^(?:Resultados|Clasificación) de (.+?) (20\d{2}) \| RFEF$/);
  const selector = doc.querySelector('#select_round_competition');
  let cambio = selector?.getAttribute('onchange')?.match(/changeRoundResult\((\d+),\s*(20\d{2}),\s*(\d+)\)/);
  const activo = selector?.querySelector('option[selected]');
  const seleccion = activo?.getAttribute('value')?.split('-');
  if (!cambio) {
    const tabla = selector?.getAttribute('onchange')?.match(/changeRoundTables\((\d+),\s*null,\s*(20\d{2})\)/);
    if (tabla && /^\d+$/.test(seleccion?.[3] || '')) cambio = [tabla[0], tabla[1], tabla[2], seleccion[3]];
  }
  if (!identificador || !cambio || !seleccion || Number(identificador[2]) !== esperada.year || Number(cambio[2]) !== esperada.year) throw new Error('No se puede confirmar la temporada o jornada de fútbol sala.');
  if (esperada.grupo !== 'playoffs' && String(cambio[3]) !== esperada.grupo) throw new Error('RFEF ha devuelto un grupo distinto al solicitado.');
  return { nombre: identificador[1], category: cambio[1], year: cambio[2], league: texto(doc.querySelector('#active_league')?.getAttribute('value') || seleccion[0]), group: cambio[3], round: seleccion[1], rounds: selector.querySelectorAll('option').map(o => o.getAttribute('value')?.split('-')[1]).filter(x => /^\d+$/.test(x || '')), grupos: doc.querySelectorAll('#select_group_competition option').map(n => n.getAttribute('value')).filter(x => /^\d+$/.test(x || '')) };
}

export function parseaAgendaFutsal(valor, ficha, fuenteUrl, verificadoEn) {
  const datos = typeof valor === 'string' ? JSON.parse(valor) : valor;
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new Error('Respuesta de fútbol sala no reconocida.');
  const eventos = [];
  for (const [fecha, dia] of Object.entries(datos)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !dia?.matches || typeof dia.matches !== 'object' || !Object.keys(dia.matches).every(k => /^\d+$/.test(k))) throw new Error('Fecha de fútbol sala no reconocida.');
    // PHP serializes a date's matches as an object when its numeric indexes have gaps.
    for (const partido of Object.values(dia.matches)) {
      if (String(partido.year) !== String(ficha.year) || String(partido.idcat) !== String(ficha.category) || String(partido.group_code) !== String(ficha.group)) throw new Error('La fuente mezcló temporada, categoría o grupo de fútbol sala.');
      const local = texto(partido.team_local), visitante = texto(partido.team_visit);
      if (!local || !visitante || !partido.id) throw new Error('Partido de fútbol sala incompleto.');
      const estadoFuente = texto(partido.status);
      const estado = /^(Finalizado|Final)$/.test(estadoFuente) ? 'finalizado' : /aplaz/i.test(estadoFuente) ? 'aplazado' : /cancel|suspend/i.test(estadoFuente) ? 'cancelado' : /primera parte|segunda parte|descanso|pr[oó]rroga|penaltis|en juego/i.test(estadoFuente) ? 'en_juego' : /^(Pendiente|Sin comenzar)$/.test(estadoFuente) ? 'programado' : 'por_confirmar';
      const resultado = ['finalizado', 'en_juego'].includes(estado) && numero(partido.r_local) !== null && numero(partido.r_visit) !== null ? { local: Number(partido.r_local), visitante: Number(partido.r_visit) } : null;
      if (estado === 'finalizado' && !resultado) throw new Error('Partido finalizado de fútbol sala sin marcador válido.');
      const inicio = String(partido.no_hour) === '0' ? fechaMadrid(fecha, partido.hour) : null;
      const emisiones = !['cancelado', 'aplazado'].includes(estado) ? (partido.tvs || []).filter(tv => texto(tv.name)).map(tv => ({ nombre: texto(tv.name), url: validaUrlDeportiva(tv.url) ? tv.url : fuenteUrl, fuenteUrl, territorio: 'España', verificadoEn })) : [];
      eventos.push({ id: `rfef-fs-${partido.year}-${partido.id}`, nombre: `${local} — ${visitante}`, local, visitante, inicio, fecha, estado, resultado, jornada: texto(partido.category).split(':').slice(1).join(':').trim() || `Jornada ${ficha.round}`, fuenteUrl, emisiones, ...(partido.status_reason ? { detalle: texto(partido.status_reason) } : {}) });
    }
  }
  if (!eventos.length) throw new Error('La fuente todavía no publica partidos para esta jornada.');
  return eventos;
}

export function parseaClasificacionFutsal(html, nombre) {
  const doc = parse(html);
  const filas = doc.querySelectorAll('#ClassificationFullTable > tr').map(fila => {
    const celdas = fila.querySelectorAll('td');
    const totales = fila.querySelectorAll('td[data-filter=total]').filter(td => !td.querySelector('img')).map(td => numero(texto(td.text)));
    const posicion = numero(texto(celdas[0]?.text));
    const equipo = texto(fila.querySelector('td.name a')?.text);
    const puntos = numero(texto(celdas[3]?.text)), jugados = numero(texto(celdas[4]?.text));
    if (!posicion || !equipo || puntos === null || jugados === null || totales.length < 5 || totales.slice(0, 5).some(n => n === null)) throw new Error('Clasificación de fútbol sala incompleta.');
    return { posicion, nombre: equipo, valores: { puntos, jugados, ganados: totales[0], empatados: totales[1], perdidos: totales[2], favor: totales[3], contra: totales[4] } };
  });
  if (!filas.length) throw new Error('No hay una tabla de clasificación publicada para esta competición.');
  return [{ id: 'general', nombre, columnas, filas }];
}

export function descubreCatalogoRFEF(html) {
  const doc = parse(html);
  const temporada = texto(doc.querySelector('select[name=season] option')?.text);
  if (!/^20\d{2}-20\d{2}$/.test(temporada)) throw new Error('RFEF no ha publicado un catálogo de temporada verificable.');
  return doc.querySelectorAll('select[name=competition] option').filter(n => /^\d+$/.test(n.getAttribute('value') || '')).map(n => ({ id: n.getAttribute('value'), nombre: texto(n.text), categoria: texto(n.parentNode.getAttribute('label')), temporada }));
}

const comparaNombre = valor => texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function parseaAgendaRFEF(html, competicion, grupo, fuenteUrl) {
  const doc = parse(html);
  if (comparaNombre(doc.querySelector('h2')?.text) !== comparaNombre(competicion.nombre)) throw new Error('RFEF no ha entregado los resultados de la competición solicitada.');
  if (!doc.querySelector(`select[name=group] option[value="${grupo}"][selected]`)) throw new Error('RFEF ha entregado otro grupo.');
  const jornada = texto(doc.querySelector('#results h3')?.text || doc.querySelectorAll('#results .fw-bold').map(n => texto(n.text)).find(t => /^Jornada \d+$/.test(t)));
  const filas = doc.querySelectorAll('#results .align-items-stretch');
  if (!filas.length) throw new Error('RFEF no ha entregado partidos para este grupo.');
  const [inicioTemporada, finTemporada] = competicion.temporada.split('-');
  return filas.map((fila, indice) => {
    const equipos = fila.querySelectorAll('.col-md-5');
    const local = texto(equipos[0]?.querySelector('.fw-bold')?.text), visitante = texto(equipos[1]?.querySelector('.fw-bold')?.text);
    const fechaHora = texto(fila.querySelector('.fa-clock')?.parentNode?.text).match(/(\d{2}\/\d{2}\/\d{4})(?:\s*-\s*(\d{2}:\d{2}))?/);
    const fecha = fechaHora ? fechaEspanola(fechaHora[1]) : null;
    if (fecha && (fecha < `${inicioTemporada}-07-01` || fecha > `${finTemporada}-09-30`)) throw new Error('RFEF mezcló resultados de otra temporada.');
    const inicio = fecha && fechaHora[2] ? fechaMadrid(fecha, fechaHora[2]) : null;
    const acta = fila.querySelector('a[href*="CodActa="]')?.getAttribute('href');
    const codigo = acta ? new URL(acta).searchParams.get('CodActa') : null;
    const marcador = texto(fila.querySelector('.text-lg')?.text).match(/^(\d+)\s*-\s*(\d+)$/);
    if (!local || !visitante) throw new Error('RFEF ha entregado un partido sin los dos equipos.');
    // A published acta supplies a score, but this page does not explicitly label
    // final/live. Preserve that distinction instead of inferring it from the clock.
    const resultado = acta && marcador ? { local: Number(marcador[1]), visitante: Number(marcador[2]) } : null;
    const detalle = resultado ? `Marcador publicado en el acta: ${resultado.local}–${resultado.visitante}. Estado del partido por confirmar.` : undefined;
    return { id: `rfef-${codigo || `${grupo}-${jornada.replace(/\D/g, '')}-${indice}`}`, nombre: `${local} — ${visitante}`, local, visitante, fecha, inicio, estado: resultado ? 'por_confirmar' : inicio ? 'programado' : 'por_confirmar', resultado, fuenteUrl, ...(jornada ? { jornada } : {}), ...(detalle ? { detalle } : {}) };
  });
}

async function obtieneRFEFFemeninoYJuvenil(opciones) {
  const catalogo = descubreCatalogoRFEF(await leerFuenteDeportiva(RFEF, opciones));
  const elegidas = catalogo.filter(c => /^(Primera Federación de Fútbol Femenino|Segunda Federación de Fútbol Femenino|Division de Honor Juvenil)$/i.test(c.nombre));
  const competiciones = [], incidencias = [], consultado = sello(opciones);
  for (const categoria of elegidas) {
    const candidato = String(Number(categoria.id) + 1);
    const primeraUrl = `${RFEF}?competition=${categoria.id}&group=${candidato}`;
    try {
      // Probe the federation's adjacent first-group identifier, but accept only
      // the complete group list actually returned in its public selector.
      const html = await leerFuenteDeportiva(primeraUrl, opciones), doc = parse(html);
      const grupos = doc.querySelectorAll('select[name=group] option').filter(n => /^\d+$/.test(n.getAttribute('value') || '')).map(n => ({ id: n.getAttribute('value'), nombre: texto(n.text) }));
      if (!grupos.some(g => g.id === candidato)) throw new Error('RFEF no ha entregado una lista de grupos comprobable.');
      for (const grupo of grupos) {
        const url = `${RFEF}?competition=${categoria.id}&group=${grupo.id}`, id = `rfef-${grupo.id}`;
        const c = { id, deporte: 'futbol', nombre: categoria.nombre, temporada: categoria.temporada, categoria: /juvenil/i.test(categoria.nombre) ? 'Fútbol juvenil' : 'Fútbol federado', genero: /femenino/i.test(categoria.nombre) ? 'femenino' : 'masculino', zona: 'España', grupo: grupo.nombre, fuente: { nombre: 'Real Federación Española de Fútbol', url }, comprobadoEn: consultado, agenda: sinDatos(url, consultado, 'eventos'), clasificacion: sinDatos(url, consultado, 'tablas') };
        try {
          const documento = grupo.id === candidato ? html : await leerFuenteDeportiva(url, opciones);
          c.agenda = bloque(url, consultado, 'eventos', parseaAgendaRFEF(documento, categoria, grupo.id, url));
          c.agenda.aviso = 'Última jornada que entrega RFEF. El resto de jornadas y el estado de cada partido se consultan en la fuente oficial.';
        } catch (error) { incidencias.push(incidencia(`${categoria.nombre} · ${grupo.nombre}`, url, error.message, id)); }
        c.clasificacion.aviso = 'El servicio de clasificación de RFEF no ha entregado una tabla verificable.';
        if (c.agenda.eventos.length) competiciones.push(c);
      }
    } catch (error) { incidencias.push(incidencia(categoria.nombre, primeraUrl, error.message)); }
  }
  return { competiciones, incidencias };
}

const envuelveLaLiga = datos => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { country: 'ES', pageProps: datos } })}</script>`;

async function obtienePrimeraFederacion(opciones) {
  const url = `${LALIGA}/otras-competiciones/primera-federacion`, consultado = sello(opciones);
  const pagina = parse(await leerFuenteDeportiva(url, opciones));
  const raiz = JSON.parse(pagina.querySelector('#__NEXT_DATA__')?.text || '{}');
  const props = raiz.props?.pageProps, publicacion = props?.subscription;
  if (props?.competition !== 'primera-federacion' || !publicacion?.slug || !/^20\d{2}$/.test(String(props.season))) throw new Error('LaLiga no identifica la temporada de Primera Federación.');
  // This is the public client configuration delivered in the anonymous page,
  // not an account credential. Never persist or log the public request identifier.
  const configuracion = raiz.runtimeConfig;
  if (configuracion?.backendUrl !== 'https://apim.laliga.com/public-service' || typeof configuracion.backendSubscription !== 'string') throw new Error('LaLiga no identifica su consulta pública de competiciones.');
  const fetcher = opciones.fetcher || fetch;
  const lee = async ruta => JSON.parse(await leerFuenteDeportiva(configuracion.backendUrl + ruta, { ...opciones, fetcher: (url, init) => fetcher(url, { ...init, headers: { ...init.headers, 'Ocp-Apim-Subscription-Key': configuracion.backendSubscription, 'Content-Language': 'es', 'Country-Code': 'ES' } }) }));
  const actual = await lee(`/api/v1/subscriptions/${encodeURIComponent(publicacion.slug)}/current-gameweek`);
  if (!numero(actual.gameweek?.week)) throw new Error('Primera Federación no publica una jornada actual verificable.');
  const fase = publicacion.rounds?.find(r => r.type === 'table' && r.has_groups && Array.isArray(r.groups));
  if (!fase?.groups.length) throw new Error('Primera Federación no ha publicado sus grupos.');
  const competiciones = [], incidencias = [];
  for (const grupo of fase.groups) {
    const id = `primera-federacion-${grupo.letter}`, nombreGrupo = texto(grupo.name).replace(/^Group /, 'Grupo ');
    const c = { id, deporte: 'futbol', nombre: 'Primera Federación', temporada: `${props.season}-${Number(props.season) + 1}`, categoria: 'Fútbol federado', genero: 'masculino', zona: 'España', grupo: nombreGrupo, fuente: { nombre: 'LALIGA', url }, comprobadoEn: consultado, agenda: sinDatos(url, consultado, 'eventos'), clasificacion: sinDatos(url, consultado, 'tablas') };
    const eventos = [];
    let agendaCompleta = true;
    for (const jornada of fase.gameweeks.filter(j => Math.abs(Number(j.week) - Number(actual.gameweek.week)) <= 1)) {
      try {
        const consulta = new URLSearchParams({ subscriptionSlug: publicacion.slug, week: String(jornada.week), groupSlug: grupo.slug, limit: '100' });
        const datos = await lee(`/api/v1/matches?${consulta}`);
        if (!Array.isArray(datos.matches) || datos.total !== datos.matches.length || datos.matches.some(p => Number(p.season?.year) !== Number(props.season))) throw new Error('LaLiga devolvió una jornada incompleta o de otra temporada.');
        eventos.push(...parseaAgendaLaLiga(envuelveLaLiga({ competition: 'primera-federacion', season: props.season, gameweek: jornada, matches: datos.matches }), 'primera-federacion', url, consultado).eventos);
      } catch (error) { agendaCompleta = false; incidencias.push(incidencia(`Primera Federación · ${nombreGrupo} · ${jornada.name}`, url, error.message, id)); }
    }
    if (agendaCompleta) c.agenda = bloque(url, consultado, 'eventos', [...new Map(eventos.map(e => [e.id, e])).values()]);
    if (c.agenda.eventos.length) c.agenda.aviso = 'Jornada actual y jornadas cercanas disponibles. No es un marcador en directo.';
    try {
      const datos = await lee(`/api/v1/subscriptions/${encodeURIComponent(publicacion.slug)}/standing?groupSlug=${encodeURIComponent(grupo.slug)}`);
      if (!Array.isArray(datos.standings) || datos.total !== datos.standings.length || datos.standings.some(f => f.group?.slug !== grupo.slug)) throw new Error('LaLiga devolvió una clasificación incompleta o de otro grupo.');
      c.clasificacion = bloque(url, consultado, 'tablas', parseaClasificacionLaLiga(envuelveLaLiga({ competition: 'primera-federacion', season: props.season, standings: datos.standings }), 'primera-federacion').tablas);
    } catch (error) { incidencias.push(incidencia(`Primera Federación · ${nombreGrupo}`, url, error.message, id)); }
    competiciones.push(c);
  }
  return { competiciones, incidencias };
}

function fechaEspanola(valor) {
  const m = texto(valor).match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (!m) return null;
  const fecha = `${m[3]}-${m[2]}-${m[1]}`;
  return fechaMadrid(fecha, '12:00') ? fecha : null;
}

export function eligeJornadasFFCV(jornadas, ahora = Date.now()) {
  const ordenadas = jornadas.map(j => ({ ...j, fechaISO: fechaEspanola(j.fecha_jornada) })).filter(j => j.fechaISO && numero(j.codjornada)).sort((a, b) => a.fechaISO.localeCompare(b.fechaISO));
  if (!ordenadas.length) return [];
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(ahora));
  let indice = ordenadas.findIndex(j => j.fechaISO >= hoy);
  if (indice < 0) indice = ordenadas.length - 1;
  return ordenadas.slice(Math.max(0, indice - 1), indice + 1);
}

export function parseaAgendaFFCV(datos, jornada, fuenteUrl) {
  if (!datos || !Array.isArray(datos.partidos) || String(datos.jornada) !== String(jornada)) throw new Error('La federación valenciana ha devuelto otra jornada o un formato incompleto.');
  const eventos = [];
  for (const partido of datos.partidos) {
    const local = texto(partido.local), visitante = texto(partido.visitante);
    if (String(partido.cod_equipo_local) === '-1' || String(partido.cod_equipo_visitante) === '-1' || /descansa/i.test(`${local} ${visitante}`)) continue;
    if (!local || !visitante || !/^\d+$/.test(String(partido.codacta))) throw new Error('Partido valenciano sin equipos o acta identificable.');
    const fecha = fechaEspanola(partido.fecha), inicio = fecha ? fechaMadrid(fecha, texto(partido.hora).slice(0, 5)) : null;
    const codigo = String(partido.estado), provisional = String(partido.resultado_provisional) === '1' || codigo === '6';
    const retirado = String(partido.retirado_local) === '1' || String(partido.retirado_visitante) === '1';
    const marcador = texto(partido.resultado).match(/^(\d+)\s*-\s*(\d+)$/);
    const estado = retirado || codigo === '4' ? 'cancelado' : codigo === '2' || codigo === '3' ? 'aplazado' : codigo === '1' && !provisional && marcador ? 'finalizado' : codigo === '0' && !provisional ? 'programado' : 'por_confirmar';
    const resultado = estado === 'finalizado' ? { local: Number(marcador[1]), visitante: Number(marcador[2]) } : null;
    const detalle = retirado ? 'Equipo retirado según la federación.' : provisional ? 'Resultado provisional: pendiente de confirmar por la federación.' : codigo === '1' && !marcador ? 'La federación no publica un marcador válido: resultado por confirmar.' : texto(partido.motivo_estado);
    eventos.push({ id: `ffcv-${partido.codacta}`, nombre: `${local} — ${visitante}`, local, visitante, inicio, fecha, estado, resultado, jornada: `Jornada ${jornada}`, fuenteUrl, ...(texto(partido.campo) ? { lugar: texto(partido.campo) } : {}), ...(detalle ? { detalle } : {}) });
  }
  return eventos;
}

export function parseaClasificacionFFCV(datos, competicion, grupo) {
  if (String(datos.codigo_competicion) !== String(competicion) || String(datos.codigo_grupo) !== String(grupo) || !Array.isArray(datos.clasificacion) || !datos.clasificacion.length) throw new Error('Clasificación valenciana vacía o de otro grupo.');
  const filas = datos.clasificacion.map(fila => {
    const valores = Object.fromEntries([['puntos', 'puntos'], ['jugados', 'jugados'], ['ganados', 'ganados'], ['empatados', 'empatados'], ['perdidos', 'perdidos'], ['favor', 'goles_a_favor'], ['contra', 'goles_en_contra']].map(([clave, campo]) => {
      if (!(clave === 'puntos' ? /^-?\d+$/ : /^\d+$/).test(String(fila[campo]))) throw new Error('Clasificación valenciana con cifras incompletas.');
      return [clave, Number(fila[campo])];
    }));
    if (!numero(fila.posicion) || !texto(fila.nombre)) throw new Error('Clasificación valenciana sin equipo o posición.');
    return { posicion: Number(fila.posicion), nombre: texto(fila.nombre), valores };
  });
  return [{ id: 'general', nombre: `Clasificación · jornada ${texto(datos.jornada)}`, columnas, filas }];
}

export async function obtieneFFCV(opciones = {}) {
  const consultado = sello(opciones), conexion = creaConsultaFFCV(opciones);
  const { estado, leer: lee } = conexion;
  const competiciones = [], incidencias = [];
  let completados = 0;
  const describeProgreso = () => {
    const total = estado.catalogo?.categorias.reduce((n, c) => n + (c.grupos?.length || 0), 0) || 0;
    const comprobados = Object.keys(estado.verificados).length;
    const descanso = estado.noConsultarAntes ? ` Próximo intento permitido a partir de ${estado.noConsultarAntes}.` : '';
    incidencias.push(incidencia('Comunidad Valenciana · actualización por grupos', FFCV, `Catálogo: ${total} grupos${estado.catalogo?.completo ? '' : ' enumerados hasta ahora'}. Se han verificado datos de ${comprobados}; cada grupo conserva su propia fecha. En esta pasada se han intentado ${completados}. Las consultas se reparten para respetar el límite de la federación.${descanso}`, 'ffcv-progreso'));
  };
  if (!conexion.disponible()) {
    if (!conexion.restantes() && !estado.noConsultarAntes) await conexion.pausaPresupuesto();
    describeProgreso(); return { competiciones, incidencias };
  }
  try {
    await conexion.iniciar();
    // Refresh the small catalogue weekly, retaining its real acquisition date.
    // Its group enumeration can span several hourly runs without starting again.
    if (!estado.catalogo || (estado.catalogo.completo && Date.parse(consultado) - Date.parse(estado.catalogo.verificadoEn) > 7 * 86400000)) {
      if (conexion.restantes() < 2) { await conexion.pausaPresupuesto(); describeProgreso(); return { competiciones, incidencias }; }
      const temporadas = (await lee('api/filtros/temporadas_fetch.php')).temporadas;
      const temporada = Array.isArray(temporadas) ? temporadas.filter(t => /^20\d{2}-20\d{2}$/.test(t.nombre) && t.fecha_inicio <= consultado.slice(0, 10)).sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio))[0] : null;
      if (!temporada) throw new Error('La federación valenciana no publica una temporada identificable.');
      const categorias = (await lee(`api/filtros/competiciones_fetch.php?temporada=${encodeURIComponent(temporada.cod_temporada)}`)).competiciones;
      if (!Array.isArray(categorias) || !categorias.length) throw new Error('El catálogo valenciano está vacío.');
      estado.catalogo = creaEstadoFFCV(categorias.map(c => ({ ...c, grupos: null })), temporada, consultado).catalogo;
      estado.cursor = 0;
      await conexion.guardar();
    }
    for (const categoria of estado.catalogo.categorias) {
      if (categoria.grupos) continue;
      if (!conexion.disponible()) break;
      const grupos = (await lee(`api/filtros/grupos_fetch.php?cod_competicion=${encodeURIComponent(categoria.codigo)}`)).grupos;
      if (!Array.isArray(grupos)) throw new Error('La competición no publica una lista de grupos reconocible.');
      categoria.grupos = grupos;
      estado.catalogo.completo = estado.catalogo.categorias.every(c => Array.isArray(c.grupos));
      await conexion.guardar();
    }
    if (!estado.catalogo.completo) {
      if (!conexion.restantes()) await conexion.pausaPresupuesto();
      describeProgreso(); return { competiciones, incidencias };
    }
    const temporada = estado.catalogo.temporada;
    const tareas = estado.catalogo.categorias.flatMap(categoria => categoria.grupos.map(grupo => ({ categoria, grupo })));
    opciones.log?.(`FFCV: catálogo conservado de ${tareas.length} grupos; continúa por el grupo ${estado.cursor + 1}, con ${conexion.restantes()} consultas disponibles en el presupuesto de esta hora.`);
    let recorridos = 0;
    while (recorridos < tareas.length && conexion.disponible()) {
      const { categoria, grupo } = tareas[estado.cursor];
      const conTabla = String(grupo.ver_clasificacion) === '1' && String(categoria.visible_clasificacion) === '1';
      // Reserve enough room for both rounds and the table before starting a group.
      if (conexion.restantes() < (conTabla ? 4 : 3)) { await conexion.pausaPresupuesto(); break; }
      const params = new URLSearchParams({ cod_temporada: String(temporada.cod_temporada), cod_competicion: String(categoria.codigo), cod_grupo: String(grupo.codigo) });
      const url = `${FFCV}?${params}`, id = `ffcv-${grupo.codigo}`, genero = generoFFCV(categoria);
      const c = { id, deporte: 'futbol', nombre: texto(categoria.nombre), temporada: temporada.nombre, categoria: /sala|futsal/i.test(categoria.TipoJuego) ? 'Fútbol sala territorial' : 'Fútbol territorial y de base', zona: 'Comunidad Valenciana', ...(genero ? { genero } : {}), grupo: texto(grupo.nombre), fuente: { nombre: 'Federació de Futbol de la Comunitat Valenciana', url }, comprobadoEn: consultado, agenda: sinDatos(url, consultado, 'eventos'), clasificacion: sinDatos(`${url}&view=clasificaciones`, consultado, 'tablas') };
      try {
        const jornadas = eligeJornadasFFCV((await lee(`api/filtros/jornadas_fetch.php?cod_grupo=${encodeURIComponent(grupo.codigo)}`)).jornadas || [], opciones.ahora);
        if (!jornadas.length) throw new Error('Todavía no hay jornadas con fecha publicada.');
        const eventos = [];
        let agendaCompleta = true;
        for (const jornada of jornadas) {
          try {
            const consulta = new URLSearchParams(params);
            consulta.set('cod_jornada', String(jornada.codjornada));
            const datos = await lee(`api/partidos/resultados_por_grupo_jornada_data.php?${consulta}`);
            eventos.push(...parseaAgendaFFCV(datos, jornada.codjornada, `${FFCV}?${consulta}`));
          } catch (error) { agendaCompleta = false; incidencias.push(incidencia(`${c.nombre} · ${c.grupo} · jornada ${jornada.codjornada}`, url, error.message, id)); }
          if (!conexion.disponible()) break;
        }
        if (agendaCompleta && !estado.noConsultarAntes) c.agenda = bloque(url, consultado, 'eventos', [...new Map(eventos.map(e => [e.id, e])).values()]);
        if (c.agenda.eventos.length) c.agenda.aviso = 'Jornada más cercana a hoy y jornada anterior publicadas por la federación. Otras jornadas, en la fuente oficial. No es un marcador en directo.';
        if (conTabla && conexion.disponible()) {
          try {
            const ultima = jornadas.at(-1).codjornada;
            const datos = await lee(`api/clasificaciones/clasificaciones_ajax.php?cod_grupo=${encodeURIComponent(grupo.codigo)}&cod_jornada=${encodeURIComponent(ultima)}`);
            c.clasificacion = bloque(`${url}&view=clasificaciones`, consultado, 'tablas', parseaClasificacionFFCV(datos, categoria.codigo, grupo.codigo));
          } catch (error) { incidencias.push(incidencia(`${c.nombre} · ${c.grupo}`, url, error.message, id)); }
        } else if (!conTabla) c.clasificacion.aviso = 'La federación no publica clasificación para este grupo.';
      } catch (error) { incidencias.push(incidencia(`${c.nombre} · ${c.grupo}`, url, error.message, id)); }
      if (c.agenda.eventos.length || c.clasificacion.tablas.length) {
        competiciones.push(c);
        estado.ultimoExito = consultado;
        estado.verificados[grupo.codigo] = consultado;
      }
      completados++;
      // A 429 keeps this group's cursor: the following permitted run retries it.
      if (estado.noConsultarAntes) { await conexion.guardar(); break; }
      estado.cursor = (estado.cursor + 1) % tareas.length;
      recorridos++;
      await conexion.guardar();
    }
    if (!conexion.restantes()) await conexion.pausaPresupuesto();
  } catch (error) { incidencias.push(incidencia('Comunidad Valenciana', FFCV, error.message, 'ffcv-fuente')); }
  describeProgreso();
  return { competiciones, incidencias };
}

async function obtieneLaLiga(slug, nombre, esperada, opciones) {
  const consultado = sello(opciones);
  const url = `${LALIGA}/${slug}`;
  const incidencias = [];
  const competicion = { id: slug, deporte: 'futbol', nombre, categoria: 'Fútbol profesional', zona: 'España', genero: esperada.includes('femenina') ? 'femenino' : 'masculino', temporada: 'Por confirmar', fuente: { nombre: 'LALIGA', url }, comprobadoEn: consultado, agenda: sinDatos(`${url}/resultados`, consultado, 'eventos'), clasificacion: sinDatos(`${url}/clasificacion`, consultado, 'tablas') };
  const lecturas = await Promise.allSettled([leerFuenteDeportiva(`${url}/resultados`, opciones), leerFuenteDeportiva(`${url}/clasificacion`, opciones)]);
  if (lecturas[0].status === 'fulfilled') {
    try {
      const principal = parseaAgendaLaLiga(lecturas[0].value, esperada, `${url}/resultados`, consultado);
      competicion.temporada = principal.temporada;
      const eventos = [...principal.eventos];
      let agendaCompleta = true;
      const cercanas = principal.jornadas.filter(j => Math.abs(Number(j.week) - Number(principal.jornada)) === 1);
      for (const jornada of cercanas) {
        const anio = principal.temporada.slice(0, 4), final = principal.temporada.slice(-2);
        const enlace = `${url}/resultados/${anio}-${final}/jornada-${jornada.week}`;
        try {
          const cercana = parseaAgendaLaLiga(await leerFuenteDeportiva(enlace, opciones), esperada, enlace, consultado);
          if (cercana.temporada !== principal.temporada) throw new Error('La jornada solicitada pertenece a otra temporada.');
          eventos.push(...cercana.eventos);
        }
        catch (error) { agendaCompleta = false; incidencias.push(incidencia(`${nombre} · ${jornada.name}`, enlace, error.message)); }
      }
      if (agendaCompleta) competicion.agenda = bloque(`${url}/resultados`, consultado, 'eventos', [...new Map(eventos.map(e => [e.id, e])).values()]);
      competicion.agenda.aviso = 'Jornada publicada y jornadas anterior y siguiente disponibles. No es un marcador en directo.';
    } catch (error) { incidencias.push(incidencia(nombre, `${url}/resultados`, error.message, slug)); }
  } else incidencias.push(incidencia(nombre, `${url}/resultados`, lecturas[0].reason.message, slug));
  if (lecturas[1].status === 'fulfilled') {
    try {
      const clasificacion = parseaClasificacionLaLiga(lecturas[1].value, esperada);
      if (competicion.temporada !== 'Por confirmar' && clasificacion.temporada !== competicion.temporada) throw new Error('La clasificación y los partidos pertenecen a distintas temporadas.');
      competicion.temporada = clasificacion.temporada;
      competicion.clasificacion = bloque(`${url}/clasificacion`, consultado, 'tablas', clasificacion.tablas);
    } catch (error) { incidencias.push(incidencia(nombre, `${url}/clasificacion`, error.message, slug)); }
  } else incidencias.push(incidencia(nombre, `${url}/clasificacion`, lecturas[1].reason.message, slug));
  return { competiciones: [competicion], incidencias };
}

async function obtieneFutsal(opciones) {
  const consultado = sello(opciones), competiciones = [], incidencias = [];
  const portada = await leerFuenteDeportiva(FUTSAL, opciones);
  const doc = parse(portada);
  const semillas = [...new Set(doc.querySelectorAll('a[href]').map(n => new URL(n.getAttribute('href'), FUTSAL)).filter(u => u.origin === FUTSAL && /^\/competicion\/[^/]+\/?$/.test(u.pathname)).map(u => u.href))];
  const descubiertas = new Map();
  for (const url of semillas) {
    try {
      const html = await leerFuenteDeportiva(url, opciones);
      const slug = new URL(url).pathname.split('/')[2];
      for (const item of descubreFutsal(html).filter(c => c.slug === slug)) {
        const clave = `${item.slug}-${item.grupo}`;
        if (!descubiertas.has(clave) || descubiertas.get(clave).year < item.year) descubiertas.set(clave, item);
      }
    } catch (error) { incidencias.push(incidencia('Fútbol sala · catálogo', url, error.message)); }
  }
  for (const item of descubiertas.values()) {
    const id = `rfef-futsal-${item.slug}-${item.grupo}`;
    const grupo = /^\d+$/.test(item.grupo) && item.slug === 'segunda-femenina' ? `Grupo ${item.grupo}` : undefined;
    const tablaUrl = item.url.replace('/resultados/', '/clasificacion/');
    let ficha;
    try { ficha = parseaFichaFutsal(await leerFuenteDeportiva(item.url, opciones), item); }
    catch (error) { incidencias.push(incidencia(`Fútbol sala · ${item.slug}`, item.url, error.message, id)); continue; }
    const competicion = { id, deporte: 'futbol', nombre: ficha.nombre, temporada: `${item.year - 1}-${item.year}`, categoria: 'Fútbol sala', zona: 'España', genero: /femenina|femenino|reina|iberdrola/i.test(ficha.nombre) ? 'femenino' : 'masculino', ...(grupo ? { grupo } : {}), fuente: { nombre: 'RFEF · Fútbol sala', url: item.url }, comprobadoEn: consultado, agenda: sinDatos(item.url, consultado, 'eventos'), clasificacion: sinDatos(tablaUrl, consultado, 'tablas') };
    const eventos = [];
    let agendaCompleta = true;
    for (const round of ficha.rounds.filter(r => Math.abs(Number(r) - Number(ficha.round)) <= 1)) {
      try {
        const body = new URLSearchParams({ category: ficha.category, league: ficha.league, round, action: 'competicion', year: ficha.year, group: ficha.group });
        const fetcher = opciones.fetcher || fetch;
        const datos = await leerFuenteDeportiva(`${FUTSAL}/futsal_xhr/get_matchs_round`, { ...opciones, fetcher: (url, init) => fetcher(url, { ...init, method: 'POST', body }) });
        eventos.push(...parseaAgendaFutsal(datos, { ...ficha, round }, item.url, consultado));
      } catch (error) { agendaCompleta = false; incidencias.push(incidencia(`${ficha.nombre} · jornada ${round}`, item.url, error.message, id)); }
    }
    if (agendaCompleta) competicion.agenda = bloque(item.url, consultado, 'eventos', [...new Map(eventos.map(e => [e.id, e])).values()]);
    if (competicion.agenda.eventos.length) competicion.agenda.aviso = 'Jornada publicada y jornadas cercanas disponibles. Horarios peninsulares. No es un marcador en directo.';
    if (item.grupo !== 'playoffs') {
      try {
        const html = await leerFuenteDeportiva(tablaUrl, opciones);
        parseaFichaFutsal(html, item);
        competicion.clasificacion = bloque(tablaUrl, consultado, 'tablas', parseaClasificacionFutsal(html, grupo || 'Clasificación general'));
      }
      catch (error) { incidencias.push(incidencia(ficha.nombre, tablaUrl, error.message, id)); }
    } else competicion.clasificacion.aviso = 'Competición por eliminatorias: consulta los partidos publicados.';
    competiciones.push(competicion);
  }
  return { competiciones, incidencias };
}

/** Each source fails independently, so a federation outage cannot remove LaLiga results. */
export async function obtieneFutbol(opciones = {}) {
  const resultados = await Promise.allSettled([
    obtieneLaLiga('laliga-easports', 'Primera División · LALIGA EA SPORTS', 'primera-division', opciones),
    obtieneLaLiga('laliga-hypermotion', 'Segunda División · LALIGA HYPERMOTION', 'segunda-division', opciones),
    obtieneLaLiga('futbol-femenino', 'Liga F Moeve', 'primera-division-femenina', opciones),
    obtieneFutsal(opciones),
    obtienePrimeraFederacion(opciones),
    obtieneRFEFFemeninoYJuvenil(opciones),
    obtieneFFCV(opciones),
  ]);
  const competiciones = [], incidencias = [];
  for (const [i, resultado] of resultados.entries()) {
    if (resultado.status === 'fulfilled') { competiciones.push(...resultado.value.competiciones); incidencias.push(...resultado.value.incidencias); }
    else incidencias.push(incidencia(['Primera División', 'Segunda División', 'Liga F', 'Fútbol sala', 'Primera Federación', 'Fútbol RFEF femenino y juvenil', 'Comunidad Valenciana'][i], [LALIGA, LALIGA, LALIGA, FUTSAL, `${LALIGA}/otras-competiciones/primera-federacion`, RFEF, FFCV][i], resultado.reason.message));
  }
  // Keep the federation's actual catalogue visible without claiming its failed selector delivers results.
  try {
    const catalogo = descubreCatalogoRFEF(await leerFuenteDeportiva(RFEF, opciones));
    const pendientes = catalogo.filter(c => !/^(Campeonato Nacional de Liga de (Primera|Segunda) División|Campeonato Nacional de Liga de Primera Federación|Primera División de Fútbol Femenino|Liga Prime Futsal|Primera División Fútbol Sala Femenino|Segunda División Fútbol Sala Masculino|Segunda División Fútbol Sala Femenino)$/.test(c.nombre));
    for (const competicion of pendientes) incidencias.push(incidencia(competicion.nombre, RFEF, `La federación enumera esta competición (${competicion.temporada}), pero todavía no podemos verificar automáticamente todos sus grupos, resultados y horarios. Consulta el selector oficial.`, `rfef-catalogo-${competicion.id}`));
  } catch (error) { incidencias.push(incidencia('Resto de categorías RFEF', RFEF, error.message)); }
  incidencias.push(
    incidencia('Fútbol territorial de Cataluña', 'https://www.fcf.cat/ca/competicio', 'El selector es público, pero sus consultas de temporadas, categorías y resultados rechazan nuestra descarga (HTTP 403). Todavía no están integradas aquí.', 'territorial-cataluna'),
    incidencia('Fútbol territorial de Euskadi', 'https://www.euskadifutbol.eus/', 'La descarga pública comprobada redirige a una pantalla de acceso. Todavía no podemos verificar automáticamente sus partidos.', 'territorial-euskadi'),
    incidencia('Fútbol territorial de Madrid', 'https://www.rffm.es/competicion/resultados-y-clasificaciones', 'La federación publica su consulta de resultados, pero todavía no hay una conexión verificada con sus grupos y jornadas.', 'territorial-madrid'),
    incidencia('Fútbol territorial de Andalucía', 'https://www.rfaf.es/', 'La consulta pública comprobada redirige a una pantalla de acceso; todavía no podemos verificar automáticamente sus resultados.', 'territorial-andalucia'),
    incidencia('Fútbol territorial de Galicia', 'https://www.futgal.es/', 'La consulta pública comprobada redirige a una pantalla de acceso; todavía no podemos verificar automáticamente sus resultados.', 'territorial-galicia'),
    incidencia('Fútbol territorial de Castilla y León', 'https://www.rfcylf.es/', 'La consulta pública comprobada redirige a una pantalla de acceso; todavía no podemos verificar automáticamente sus resultados.', 'territorial-castilla-leon'),
    incidencia('Fútbol territorial de Navarra', 'https://www.futnavarra.es/', 'La consulta pública comprobada redirige a una pantalla de acceso; todavía no podemos verificar automáticamente sus resultados.', 'territorial-navarra'),
    ...[
      ['Asturias', 'asturias', 'https://www.asturfutbol.es/'],
      ['Aragón', 'aragon', 'https://www.futbolaragon.com/'],
      ['Baleares', 'baleares', 'https://ffib.es/Fed/NPcd/NFG_CmpJornada?cod_primaria=1000110'],
      ['Región de Murcia', 'murcia', 'https://webffrm.novanet.es/pnfg/NPcd/NFG_CmpJornada?cod_primaria=1000120'],
      ['Extremadura', 'extremadura', 'https://www.fexfutbol.com/'],
      ['Canarias', 'canarias', 'https://www.federacioncanariafutbol.es/pnfg/NPortada'],
      ['Cantabria', 'cantabria', 'https://www.rfcf.es/'],
      ['La Rioja', 'rioja', 'https://www.frfutbol.com/'],
      ['Castilla-La Mancha', 'castilla-la-mancha', 'https://www.ffcm.es/'],
      ['Ceuta', 'ceuta', 'https://www.rffce.es/'],
      ['Melilla', 'melilla', 'https://www.rfmf.es/'],
    ].map(([nombre, id, url]) => incidencia(`Fútbol territorial de ${nombre}`, url, 'La consulta automática comprobada redirige a una pantalla de acceso; todavía no hemos podido verificar sus grupos ni partidos.', `territorial-${id}`)),
  );
  return { competiciones, incidencias };
}
