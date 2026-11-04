// list — fuente REAL del cliente (migrado de src/html/client/*.ts, B2).
// Escapes SIMPLES (ya no vive en template literal). Se empaqueta con
// scripts/gen-client-bundle.mjs → public/static/app.js. Editar AQUI.

// ---- RENDER LIST (paginacion virtual, 30 items + scroll infinito) ----
var PAGE_SIZE = 30;
var listStations = [];
var listOffset = 0;
// Estadisticas de precios del listado actualmente visible (calculadas en
// applyFilters una sola vez por filtro). Se usan para pintar chips de
// anomalia ("caro para el listado") en cardHTML sin tener que re-ordenar en
// cada render. null si hay menos de 10 estaciones con precio (muestra
// estadistica demasiado pequena para llamar a algo outlier).
var listPriceStats = null;

// ---- COMPARADOR ----
// Lista de IDs de estaciones en la seleccion actual del comparador. Max 2.
// Se alimenta desde los popups (click en "⚖️ Comparar") y se
// consume al renderizar el modal (renderCompareModal). La persistencia en
// localStorage es a proposito laxa: si el usuario recarga, la seleccion
// se pierde — queremos que el comparador sea efímero, no un estado
// pegajoso que confunda.
var compareIds = [];

// Anade (o quita si ya estaba) una estacion a la seleccion. Si al anadir
// llegamos a 2, abrimos el modal automáticamente — el tercer click desde
// el popup, en cambio, actualiza la lista pero no ya abre otra vez el modal.
function toggleCompare(id) {
  var idx = compareIds.indexOf(id);
  if (idx !== -1) {
    compareIds.splice(idx, 1);
    renderCompareChip();
    return { action: 'removed', len: compareIds.length };
  }
  // Si ya hay 2, sustituimos la primera (FIFO) — evitamos lista infinita y
  // dejamos al usuario "rotar" estaciones comparando la ultima vs. la nueva
  // sin tener que borrar manualmente.
  if (compareIds.length >= 2) compareIds.shift();
  compareIds.push(id);
  renderCompareChip();
  return { action: 'added', len: compareIds.length };
}

function clearCompareSelection() {
  compareIds = [];
  renderCompareChip();
}

// Chip flotante: visible si hay 1 o 2 estaciones. Se hace foco-accesible
// (aria-live=polite) para que los lectores de pantalla anuncien cuando el
// usuario pasa de 0 a 1 o de 1 a 2 estaciones seleccionadas.
function renderCompareChip() {
  var chip = document.getElementById('compare-chip');
  if (!chip) return;
  var txt = document.getElementById('compare-chip-text');
  var n = compareIds.length;
  if (n === 0) {
    chip.classList.remove('show');
    chip.setAttribute('aria-hidden', 'true');
    return;
  }
  chip.classList.add('show');
  chip.setAttribute('aria-hidden', 'false');
  if (txt) {
    txt.textContent = n === 1
      ? '⚖️ 1 estacion seleccionada — anade otra'
      : '⚖️ 2 estaciones — pulsa para comparar';
  }
}

// Busca el objeto estacion completo para un id dado. Primero en
// filteredStations (lo que el usuario ve ahora); si no, en allStations
// (snapshot completo) — asi el comparador sigue funcionando aunque el
// usuario haya filtrado por provincia/abiertas despues de seleccionar.
function findStationById(id) {
  var list = filteredStations && filteredStations.length ? filteredStations : allStations;
  if (!list) return null;
  for (var i = 0; i < list.length; i++) {
    if (stationId(list[i]) === id) return list[i];
  }
  return null;
}

// Ship 9: Comparador multi-combustible.
//
// Cambios vs version anterior:
//  - Usa las CLAVES REALES del feed ("Precio Gasolina 95 E5", ...) — antes
//    usaba codigos cortos ('95', 'diesel') que no existen en el objeto
//    estacion (bug: siempre salia "Sin precio" en la tabla).
//  - Soporta los 9 combustibles del dropdown (antes solo 4: 95/98/A/Premium).
//  - Solo pinta filas donde al menos UNA estacion tiene precio — asi las
//    estaciones de carretera (95/98/diesel) no muestran 5 filas vacias de
//    GLP/GNC/H2 que nadie tiene, y a la inversa, una estacion solo-GLP
//    no muestra 4 filas vacias de gasolina.
//  - Calcula delta % entre el ganador y los demas por combustible, y lo
//    muestra a la derecha del precio del no-ganador (ej. "1,589 €/L +2,1%").
//  - Summary bar arriba: "Rotulo A gana en 3 de 4 combustibles".
function renderCompareModal() {
  var body = document.getElementById('compare-body');
  if (!body) return;
  if (compareIds.length === 0) {
    body.innerHTML = '<div class="compare-empty">Selecciona estaciones desde el mapa o la lista para compararlas.</div>';
    return;
  }
  var stations = [];
  for (var i = 0; i < compareIds.length; i++) {
    var s = findStationById(compareIds[i]);
    if (s) stations.push(s);
  }
  if (stations.length === 0) {
    body.innerHTML = '<div class="compare-empty">No se encontraron las estaciones seleccionadas en el snapshot actual.</div>';
    return;
  }

  // Orden canonico de combustibles: priorizamos los 4 principales primero,
  // luego alternativos. Clave = clave REAL en el objeto estacion (post-
  // normalizeStation). Label = texto amigable para UI.
  var fuels = [
    ['Precio Gasolina 95 E5',           'Gasolina 95 E5'],
    ['Precio Gasolina 98 E5',           'Gasolina 98 E5'],
    ['Precio Gasoleo A',                'Gasóleo A (diésel)'],
    ['Precio Gasoleo Premium',          'Gasóleo Premium'],
    ['Precio Diesel Renovable',         'Diésel renovable'],
    ['Precio Gases licuados del petroleo', 'GLP (autogas)'],
    ['Precio Gas Natural Comprimido',   'Gas Natural (GNC)'],
    ['Precio Gas Natural Licuado',      'Gas Natural (GNL)'],
    ['Precio Hidrogeno',                'Hidrógeno']
  ];

  // Pre-calculamos minimo por combustible + filtramos filas donde NINGUNA
  // estacion tiene precio (ruido puro). mins[key] = null si ningun precio.
  var mins = {};
  var visibleFuels = [];
  for (var f = 0; f < fuels.length; f++) {
    var code = fuels[f][0];
    var lowest = null;
    var anyHasPrice = false;
    for (var si = 0; si < stations.length; si++) {
      var p = parsePrice(stations[si][code]);
      if (p != null) {
        anyHasPrice = true;
        if (lowest == null || p < lowest) lowest = p;
      }
    }
    if (anyHasPrice) {
      mins[code] = lowest;
      visibleFuels.push(fuels[f]);
    }
  }

  // Contador de victorias por estacion (empate cuenta para ambos). Usamos
  // indice como clave — stationId podria colisionar en casos raros con strings
  // raros, y el indice es estable dentro de esta render.
  var winCounts = stations.map(function() { return 0; });
  visibleFuels.forEach(function(ff) {
    var code = ff[0];
    var low = mins[code];
    if (low == null) return;
    for (var si = 0; si < stations.length; si++) {
      var p = parsePrice(stations[si][code]);
      if (p != null && Math.abs(p - low) < 0.0005) winCounts[si] += 1;
    }
  });

  // Summary bar — solo con >=2 estaciones y >=1 combustible visible.
  var summaryHtml = '';
  if (stations.length >= 2 && visibleFuels.length >= 1) {
    var summaryItems = stations.map(function(s, idx) {
      var rot = esc(s['Rotulo'] || 'Gasolinera');
      var w = winCounts[idx];
      var badgeCls = w === 0 ? 'compare-sum-zero'
                   : (w === visibleFuels.length ? 'compare-sum-full' : 'compare-sum-some');
      return '<div class="compare-sum-item ' + badgeCls + '">'
           +   '<span class="compare-sum-count">' + w + '/' + visibleFuels.length + '</span>'
           +   '<span class="compare-sum-label">' + rot + '</span>'
           + '</div>';
    }).join('');
    summaryHtml = '<div class="compare-summary">'
               +   '<div class="compare-sum-title">🏆 Ganador por combustible</div>'
               +   '<div class="compare-sum-grid">' + summaryItems + '</div>'
               + '</div>';
  }

  var cols = stations.map(function(s) {
    var id = stationId(s);
    var status = isOpenNow(s['Horario'], s);
    var statusChip = status
      ? (status.open
          ? '<span class="status-chip status-open">● Abierta</span>'
          : '<span class="status-chip status-closed">● Cerrada</span>')
      : '';
    var priceRows = visibleFuels.map(function(ff) {
      var code = ff[0];
      var label = ff[1];
      var p = parsePrice(s[code]);
      var low = mins[code];
      var isWinner = p != null && low != null && Math.abs(p - low) < 0.0005;
      var cls = 'compare-price-row'
              + (isWinner && stations.length > 1 ? ' compare-winner' : '')
              + (p == null ? ' compare-price-row--empty' : '');
      // Delta: mostramos +X,X% si la estacion NO gana y el precio existe.
      // Usamos (p - low) / low para que el valor positivo refleje "mas caro".
      var deltaHtml = '';
      if (p != null && low != null && !isWinner && stations.length > 1 && low > 0) {
        var pct = ((p - low) / low) * 100;
        deltaHtml = '<span class="cp-delta">+' + pct.toFixed(1).replace('.', ',') + '%</span>';
      }
      // Si p == null, la estacion no distribuye ese combustible (""  en el
      // feed del Ministerio). "No se vende aquí" deja claro que no es
      // un fallo de datos sino una ausencia real de producto en el surtidor.
      var valueHtml = (p != null)
        ? '<span class="cp-value">' + p.toFixed(3) + ' €/' + fuelUnit(code) + '</span>' + deltaHtml
        : '<span class="cp-value cp-value--none">No se vende aquí</span>';
      return '<div class="' + cls + '"><span class="cp-label">' + esc(label) + '</span>' + valueHtml + '</div>';
    }).join('');
    var horario = s['Horario'] || '';
    return ''
      + '<div class="compare-col">'
      +   '<h3>⛽ ' + esc(s['Rotulo'] || 'Gasolinera') + '</h3>'
      +   '<div class="compare-dir">📍 ' + esc(s['Direccion'] || '') + '</div>'
      +   '<div class="compare-muni">' + esc(s['Municipio'] || '') + (s['Provincia'] ? ' &middot; ' + esc(s['Provincia']) : '') + '</div>'
      +   (statusChip ? '<div>' + statusChip + '</div>' : '')
      +   '<div class="compare-prices">' + priceRows + '</div>'
      +   (horario ? '<div class="compare-meta"><span>🕐 ' + esc(horario) + '</span></div>' : '')
      + '</div>';
  }).join('');
  // Si solo hay 1, anadimos una columna placeholder para mantener la grid
  // de 2-cols y evitar que la unica columna ocupe el ancho completo.
  if (stations.length === 1) {
    // Estilos en styles.ts (.compare-col--empty).
    cols += '<div class="compare-col compare-col--empty"><div>➕<br>Anade otra estacion<br>desde el mapa o lista<br>para comparar</div></div>';
  }
  body.innerHTML = summaryHtml + cols;
}

function openCompareModal() {
  renderCompareModal();
  var m = document.getElementById('modal-compare');
  if (m) m.classList.add('show');
}

function closeCompareModal() {
  var m = document.getElementById('modal-compare');
  if (m) m.classList.remove('show');
}

// Ship 20: abre el modal de historico. Reusa buildHistoryPlaceholder (mapa) +
// renderHistoryPanel — el placeholder lleva data-* con todo lo que el renderer
// necesita, asi que con inyectar el HTML y llamar al panel con days=30 ya
// tenemos sparkline + stats + toggles de rango (7/30/90/1a). Los toggles
// tienen un listener global en ui.ts que dispara re-fetch al hacer click,
// asi que esto no toca eventos.
function openHistoryModal(station, fuel, fuelLabel) {
  var m = document.getElementById('modal-history');
  var body = document.getElementById('history-body');
  var subtitle = document.getElementById('history-subtitle');
  if (!m || !body) return;
  var id = stationId(station);
  var provinciaId = station['IDProvincia'] || '';
  var price = parsePrice(station[fuel]);
  var rotulo = station['Rotulo'] || 'Gasolinera';
  var loc = station['Municipio'] ? (station['Municipio'] + (station['Provincia'] ? ', ' + station['Provincia'] : '')) : '';
  if (subtitle) subtitle.textContent = rotulo + (loc ? ' · ' + loc : '');
  // Inyectamos el placeholder — mismo DOM que el popup del mapa. Llamar a
  // renderHistoryPanel(panel, 30) dispara el fetch y pinta el sparkline.
  body.innerHTML = buildHistoryPlaceholder(id, provinciaId, fuel, fuelLabel, price);
  var panel = body.querySelector('[data-hist-station]');
  if (panel) renderHistoryPanel(panel, 30);
  m.classList.add('show');
}

function closeHistoryModal() {
  var m = document.getElementById('modal-history');
  if (m) m.classList.remove('show');
}

function cardHTML(s, i, fuel, fuelLabel) {
  var price = parsePrice(s[fuel]);
  var color = priceColor(price);
  var badgeCls = 'badge badge-' + color;
  var id = stationId(s);
  var fav = isFav(id);

  // Medalla top3 + ahorro por deposito
  var medal = '';
  if (topCheapIds[id] && price) {
    var rank = topCheapIds[id];
    medal = '<span class="medal" aria-hidden="true">' + (rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉') + '</span>';
  }
  var distHtml = '';
  if (munCenter) {
    var posC = stationLatLng(s);
    if (posC) {
      var kmC = distanceKm(munCenter.lat, munCenter.lng, posC.lat, posC.lng);
      var distanceText = kmC < 1 ? Math.round(kmC * 1000) + ' m' : kmC.toFixed(1) + ' km';
      var originText = searchOrigin ? 'tu ubicación' : 'el centro de la zona';
      distHtml = '<span class="distance-chip" title="En línea recta desde ' + originText + '">' + distanceText + ' en línea recta</span>';
    }
  }

  var savingsHtml = '';
  if (fuelUnit(fuel) === 'L' && price && currentMedianPrice && currentMedianPrice > price) {
    var litres = getRefuelLitres();
    var grossC = (currentMedianPrice - price) * litres;
    if (grossC >= 0.5) {
      savingsHtml = '<span class="savings-badge" title="Comparado con el precio central de esta búsqueda; no incluye el viaje">💰 ahorras ' + grossC.toFixed(2) + ' € en ' + litres + ' L</span>';
    }
  }

  // Chip "Caro para el listado": precio >= p90 y no esta en top3 mas baratas
  // (imposible logicamente pero defensivo). Senala al usuario que hay mejores
  // opciones en el mismo conjunto filtrado. Se muestra aunque el savings sea
  // negativo — son dos senales distintas: "comparado con mediana" vs
  // "comparado con percentil 90".
  var anomalyHtml = '';
  if (price && listPriceStats && !topCheapIds[id]) {
    if (price >= listPriceStats.p90) {
      var overMed = ((price / listPriceStats.med - 1) * 100);
      var pctTxt = overMed >= 1 ? ' (+' + overMed.toFixed(0) + '% vs mediana)' : '';
      anomalyHtml = '<span class="anomaly-chip anomaly-chip--expensive" title="Precio entre el 10% mas caro del listado actual' + pctTxt + '">💸 Caro para el listado</span>';
    }
  }

  // Ship 19: predict slot SOLO en top-3 (medallas). Motivo: el predict cuesta
  // una llamada a D1 + 1 RTT por estacion y la mayoria de usuarios solo mira
  // las baratas del listado. Lanzar predict para 100+ cards es overkill y
  // quemaria el rate-limit de /api/predict. Las top-3 son el segmento donde
  // el badge aporta mas (el usuario esta a 1 tap de elegir esa estacion y
  // quiere saber si su precio es realmente bueno vs ciclo semanal).
  var predictSlot = '';
  if (topCheapIds[id] && price && id) {
    // data-predict="1" lo busca renderPredictSlots(). data-price permite
    // al endpoint calcular percentil sin segunda query a D1.
    predictSlot = '<span class="predict-slot" data-predict="1" data-sid="' + esc(id) + '" data-fuel="' + esc(fuel) + '" data-price="' + price.toFixed(3) + '"></span>';
  }

  // Horario vivo
  var statusHtml = '';
  var status = isOpenNow(s['Horario'], s);
  if (status) {
    if (status.open) {
      statusHtml = '<span class="status-chip status-open" aria-label="Abierta ahora">● Abierta'
                 + (status.closesAt ? ' &middot; cierra ' + esc(status.closesAt) : '') + '</span>';
    } else {
      statusHtml = '<span class="status-chip status-closed" aria-label="Cerrada ahora">● Cerrada'
                 + (status.opensAt ? ' &middot; abre ' + esc(status.opensAt) : '') + '</span>';
    }
  }
  // Ship 25.6: chip "Solo socios" para Costco. Mismo criterio que el popup —
  // que el usuario sepa antes de decidir conducir hasta ahi que necesita
  // tarjeta del club.
  if ((s['Rotulo'] || '').toUpperCase().indexOf('COSTCO') >= 0) {
    statusHtml += '<span class="status-chip status-members" aria-label="Solo para socios de Costco Club" title="Necesitas tarjeta de socio Costco Club para repostar">🔑 Solo socios</span>';
  }

  var priceText = price ? fmtPriceUnit(price, fuel) : '';
  // Solo multiplicar por litros cuando el precio se publica por litro.
  var tankLitersCard = getRefuelLitres();
  var tankCostHtml = '';
  if (price && fuelUnit(fuel) === 'L') {
    var tankTotal = (price * tankLitersCard).toFixed(2);
    tankCostHtml = '<div class="row-tank-cost" title="Coste de repostar ' + tankLitersCard + ' L">' + tankLitersCard + ' L = ' + tankTotal + ' €</div>';
  }
  // Cuando la estacion no distribuye este combustible (Ministerio publica ""),
  // priceEl muestra "No se vende" en vez de N/D. Asi el usuario distingue de un
  // vistazo "esta gasolinera no tiene este producto" de "falta el dato".
  var priceEl = price
    ? '<span class="' + badgeCls + '">' + priceText + '</span>'
    : '<span class="row-row-noprice">No se vende</span>';

  // Ship 20: boton historico en cada card. data-hist-open lleva el indice
  // para que el listener delegado lo resuelva y llame a openHistoryModal.
  // No disparamos fetch al renderizar — solo al click. Boton pequeno para no
  // robar espacio al precio.
  // Si la estacion no vende este combustible, no hay historico que mostrar
  // (el modal saldria vacio y confundiria: mejor no ofrecerlo).
  var histBtn = price ? '<button class="card-hist-btn" data-hist-open="' + i + '" aria-label="Ver historial de precios" title="Historial de precios">📈</button>' : '';

  return '<div class="station-card" data-idx="' + i + '" data-zoom="1" role="listitem" tabindex="0" aria-label="' + esc((s['Rotulo']||'Gasolinera')+' en '+(s['Municipio']||'')+(price?', '+priceText:'')) + '">'
    + '<button class="fav-btn' + (fav ? ' active' : '') + '" data-fav-id="' + esc(id) + '" aria-label="' + (fav ? 'Quitar de favoritas' : 'Añadir a favoritas') + '" aria-pressed="' + fav + '">'
    + (fav ? '★' : '☆') + '</button>'
    + '<div class="row-info-flex">'
    + '<div class="row-info-left">'
    + '<div class="card-title">' + medal + '⛽ ' + esc(s['Rotulo'] || 'Gasolinera') + distHtml + '</div>'
    + '<div class="card-sub">📍 ' + esc(s['Direccion'] || '') + ', ' + esc(s['Municipio'] || '') + '</div>'
    + '<div class="card-time">🕐 ' + horarioCard(s['Horario']) + statusHtml + '</div>'
    + (savingsHtml || anomalyHtml || predictSlot ? '<div class="u-mt-3">' + savingsHtml + (savingsHtml && (anomalyHtml || predictSlot) ? ' ' : '') + anomalyHtml + (anomalyHtml && predictSlot ? ' ' : '') + predictSlot + '</div>' : '')
    + '</div>'
    + '<div class="row-info-right">'
    + priceEl
    + tankCostHtml
    + '<div class="row-fuel-label">' + esc(fuelLabel.slice(0,18)) + '</div>'
    + histBtn
    + '</div></div></div>';
}

function appendPage() {
  var list = document.getElementById('station-list');
  var fuel = document.getElementById('sel-combustible').value;
  var fuelLabel = document.getElementById('sel-combustible').selectedOptions[0].text;
  var sentinel = list.querySelector('#list-sentinel');
  var slice = listStations.slice(listOffset, listOffset + PAGE_SIZE);
  if (!slice.length) {
    // Ship 25.3: no quedan mas — ocultamos el sentinel explicitamente. Sin este
    // branch, si el observer dispara con listOffset == listStations.length (p.ej.
    // cuando el ultimo appendPage dejo justo todo cargado y el sentinel seguia
    // intersectando), slice.length es 0 y retornamos sin ocultarlo — "Cargando
    // mas..." se quedaba visible para siempre.
    if (sentinel) sentinel.style.display = 'none';
    return;
  }
  var frag = slice.map(function(s, j) { return cardHTML(s, listOffset + j, fuel, fuelLabel); }).join('');
  // Ship 25.3: insertamos las cards ANTES del sentinel para que "Cargando mas..."
  // quede siempre al FINAL de la lista (comportamiento estandar de infinite
  // scroll). Antes se usaba list.insertAdjacentHTML('beforeend'), que metia
  // las cards DESPUES del sentinel — este se quedaba pegado arriba del todo
  // y el usuario veia "Cargando mas..." al principio de la lista (confuso).
  if (sentinel) {
    sentinel.insertAdjacentHTML('beforebegin', frag);
  } else {
    list.insertAdjacentHTML('beforeend', frag);
  }
  listOffset += slice.length;
  if (sentinel) sentinel.style.display = listOffset >= listStations.length ? 'none' : 'block';
  // Ship 19: rellenamos los predict slots que se hayan insertado en esta
  // pagina. Como el primer appendPage trae las top-3, tipicamente hay 3
  // slots pero si el usuario pagina mas alla no hay ninguno — no pasa nada,
  // el selector se salta silent.
  renderPredictSlots();
}

// Ship 19: lanza un fetchPredict por cada .predict-slot nuevo (data-predict="1"),
// pinta el badge resultado y marca el slot como "done" (data-predict="0") para
// que re-renders posteriores no vuelvan a pedirlo. fetchPredict tiene su propio
// cache in-memory — esto es solo el controlador UI. Errores de red caen a
// badge vacio (sin ruido). data-fuel trae la etiqueta larga del Ministerio
// ("Precio Gasolina 95 E5"); fetchPredict mapea internamente a codigo corto.
function renderPredictSlots() {
  var slots = document.querySelectorAll('.predict-slot[data-predict="1"]');
  if (!slots.length) return;
  for (var i = 0; i < slots.length; i++) {
    (function(el) {
      el.setAttribute('data-predict', '0');  // lock antes de fetch (evita doble-fire)
      var sid = el.getAttribute('data-sid') || '';
      var fuelLabel = el.getAttribute('data-fuel') || '';
      var price = parseFloat(el.getAttribute('data-price') || '');
      if (!sid || !fuelLabel || !isFinite(price)) return;
      fetchPredict(sid, fuelLabel, price).then(function(pred) {
        if (!pred) return;
        el.innerHTML = predictBadgeHTML(pred);
      }).catch(function() { /* silencioso */ });
    })(slots[i]);
  }
}

function renderList(stations) {
  var list = document.getElementById('station-list');
  var fuel = document.getElementById('sel-combustible').value;
  list.setAttribute('aria-busy', 'false');

  if (!stations.length) {
    if (list._observer) list._observer.disconnect();
    document.getElementById('stats-bar').style.display = 'none';
    list.innerHTML = '<div class="empty-state"><div class="icon" aria-hidden="true">&#x1F50D;</div><p>Sin resultados</p><small>Prueba con otros filtros</small></div>';
    return;
  }

  var prices = stations.map(function(s) { return parsePrice(s[fuel]); }).filter(function(p) { return p !== null; });
  var sMin = prices.length ? Math.min.apply(null, prices) : null;
  var sMax = prices.length ? Math.max.apply(null, prices) : null;
  var sAvg = prices.length ? (prices.reduce(function(a, b) { return a+b; }, 0)/prices.length) : null;

  document.getElementById('stats-bar').style.display = 'block';
  document.getElementById('stat-n').textContent = stations.length;
  document.getElementById('stat-min').textContent = sMin ? sMin.toFixed(3) + ' €' : 'N/D';
  document.getElementById('stat-avg').textContent = sAvg ? sAvg.toFixed(3) + ' €' : 'N/D';
  document.getElementById('stat-max').textContent = sMax ? sMax.toFixed(3) + ' €' : 'N/D';

  // Reset estado virtual
  listStations = stations;
  listOffset = 0;
  list.innerHTML = '<div id="list-sentinel" class="list-sentinel">Cargando mas...</div>';
  appendPage(); // primera pagina

  // IntersectionObserver para cargar al llegar al final
  if (list._observer) list._observer.disconnect();
  var sentinel = list.querySelector('#list-sentinel');
  var observer = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && listOffset < listStations.length) appendPage();
  }, { root: list, threshold: 0.1 });
  observer.observe(sentinel);
  list._observer = observer;
}

function zoomTo(idx) {
  var s = filteredStations[idx];
  var lat = parseFloat((s['Latitud'] || '').replace(',', '.'));
  var lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',', '.'));
  if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
    map.setView([lat, lng], 17);
    clusterGroup.eachLayer(function(layer) {
      var lpos = layer.getLatLng();
      if (Math.abs(lpos.lat - lat) < 0.0002 && Math.abs(lpos.lng - lng) < 0.0002) {
        layer.openPopup();
      }
    });
  }
  highlightCard(idx);
  // Close sidebar on mobile
  if (window.innerWidth < 1024 && typeof closeMobileSidebar === 'function') closeMobileSidebar();
}

// ---- SORT & FILTER ----
// Centro de busqueda. Las coordenadas GPS solo viven en memoria y en el hash.
var munCenter = null;
var searchOrigin = null;
function getSearchArea() {
  var control = document.getElementById('sel-area');
  return searchOrigin || (control && control.value === 'cerca') ? 'cerca' : 'municipio';
}
function setSearchOrigin(origin) {
  var lat = origin && Number(origin.lat), lng = origin && Number(origin.lng);
  searchOrigin = origin && isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? { lat: lat, lng: lng } : null;
  munCenter = searchOrigin;
}

function setupMunicipioRadio(munMode, idMun) {
  var rg = document.getElementById('radius-group');
  if (searchOrigin) {
    munCenter = searchOrigin;
    if (rg) rg.style.display = 'block';
    return;
  }
  if (!munMode || !idMun) {
    munCenter = null;
    if (rg) rg.style.display = 'none';
    return;
  }
  var sumLat = 0, sumLng = 0, n = 0;
  for (var i = 0; i < allStations.length; i++) {
    if (String(allStations[i]['IDMunicipio']) !== String(idMun)) continue;
    var pos = stationLatLng(allStations[i]);
    if (pos) { sumLat += pos.lat; sumLng += pos.lng; n++; }
  }
  munCenter = n > 0 ? { lat: sumLat / n, lng: sumLng / n } : null;
  if (rg) rg.style.display = munCenter && getSearchArea() === 'cerca' ? 'block' : 'none';
}

function applyFilters() {
  var fuel  = document.getElementById('sel-combustible').value;
  // El orden es siempre por precio (mas barato primero). Los selectores de
  // orden, busqueda por texto y filtros avanzados se retiraron del sidebar.
  var radius = parseInt(document.getElementById('in-radius').value, 10);

  var stations = allStations.slice();
  var selectedMunicipality = document.getElementById('sel-municipio').value;
  if (!searchOrigin && selectedMunicipality && getSearchArea() === 'municipio') {
    stations = stations.filter(function(s) { return String(s.IDMunicipio) === selectedMunicipality; });
  }

  // Filtro por radio centrado en el municipio elegido (munCenter): al elegir
  // un municipio, mostramos las gasolineras en un radio de N km a su alrededor.
  var center = munCenter;
  var radiusActive = !!munCenter && getSearchArea() === 'cerca';
  if (center && radiusActive && radius) {
    stations = stations.filter(function(s) {
      var pos = stationLatLng(s);
      if (!pos) return false;
      return distanceKm(center.lat, center.lng, pos.lat, pos.lng) <= radius;
    });
  }

  // Mediana para calculo de ahorro
  var prices = stations.map(function(s) { return parsePrice(s[fuel]); });
  currentMedianPrice = median(prices);

  // Orden: mas barato primero (las estaciones sin precio, al final).
  stations.sort(function(a, b) {
    var pa = parsePrice(a[fuel]), pb = parsePrice(b[fuel]);
    if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1;
    return pa - pb;
  });

  // Top 3 mas baratas (para medallas)
  topCheapIds = {};
  var ranking = stations
    .map(function(s) { return { id: stationId(s), p: parsePrice(s[fuel]) }; })
    .filter(function(x) { return x.p; })
    .sort(function(a,b) { return a.p - b.p; });
  for (var i = 0; i < Math.min(3, ranking.length); i++) {
    topCheapIds[ranking[i].id] = i + 1;
  }

  // Estadisticas para chip de anomalia. Usamos p90 del listado filtrado:
  // senalamos estaciones >=p90 con un chip "Caro para el listado" para que
  // el usuario sepa que hay mejores opciones en el mismo conjunto sin tener
  // que mirar los 3 primeros.
  // Minimo 10 precios: por debajo, "outlier" es ruido.
  listPriceStats = null;
  var pricesAsc = ranking.map(function(x) { return x.p; });  // ya ordenado
  if (pricesAsc.length >= 10) {
    // floor en lugar de round para que la cohorte >=p90 incluya exactamente
    // el 10% superior (o un poquito mas si el corte cae entre valores).
    var p90 = pricesAsc[Math.floor(pricesAsc.length * 0.90)];
    var med = pricesAsc[Math.floor(pricesAsc.length * 0.50)];
    listPriceStats = { p90: p90, med: med, n: pricesAsc.length };
  }

  filteredStations = stations;
  renderMarkers(stations);
  renderList(stations);

  var lbl = document.getElementById('lbl-count');
  lbl.textContent = stations.length + ' gasolineras';
  lbl.style.display = 'inline-block';

  // Guardar historico de precios (favoritos + visitados recientes).
  recordHistoryForTracked(stations, fuel);
  // Refrescar el panel de favoritas (si el modal esta abierto).
  renderFavsPanel();
  if (typeof restoreSharedStation === 'function') restoreSharedStation();
}

// ---- CACHE localStorage ----
// Fresco: <4h, datos casi en tiempo real
// Stale: 4h-30d, se puede usar como fallback cuando el Ministerio esta caido
var CACHE_FRESH_TTL = 4 * 60 * 60 * 1000;
var CACHE_HARD_TTL  = 30 * 24 * 60 * 60 * 1000;
function cacheKey(idProv, idMun) { return 'gs_v2_' + idProv + '_' + (idMun || 'all'); }
function getCache(key, allowStale) {
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    var ts = parsed.ts, data = parsed.data, fecha = parsed.fecha;
    var age = Date.now() - ts;
    if (age > CACHE_HARD_TTL) { localStorage.removeItem(key); return null; }
    if (!allowStale && age > CACHE_FRESH_TTL) return null;
    return { data: data, fecha: fecha, ts: ts, stale: age > CACHE_FRESH_TTL };
  } catch(e) { return null; }
}
function setCache(key, data, fecha) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data, fecha: fecha })); } catch(e) {}
}

// ---- CACHE AGE INDICATOR ----
function formatAge(ts) {
  var mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 2) return 'ahora mismo';
  if (mins < 60) return 'hace ' + mins + ' min';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return 'hace ' + hrs + 'h';
  return 'hace ' + Math.floor(hrs/24) + 'd';
}

function showCacheIndicator(ts, stale, fecha) {
  var lbl = document.getElementById('lbl-update');
  var age = formatAge(ts);
  var source = fecha ? 'Datos: ' + fecha + ' · copia ' : 'Copia descargada ';
  lbl.title = fecha ? 'Fecha publicada por el Ministerio: ' + fecha : 'Fecha de descarga; la fuente no indicó la fecha de los precios';
  lbl.innerHTML = '';
  if (stale) {
    lbl.appendChild(document.createTextNode('⚠ ' + source + age + ' '));
    var btn = document.createElement('button');
    btn.textContent = 'Actualizar';
    // Estilos en styles.ts (.cache-refresh-btn).
    btn.className = 'cache-refresh-btn';
    btn.addEventListener('click', forceReload);
    lbl.appendChild(btn);
  } else {
    lbl.textContent = source + age;
  }
  lbl.style.display = 'inline';
}

function forceReload() {
  return loadStations({ force: true });
}

// ---- API CALLS (via proxy Hono) ----
// ---- PROVINCIAS HARDCODEADAS (INE oficial, 52 entradas) ----
// No dependemos de la API del Ministerio para el listado estatico de provincias.
var SPAIN_PROVINCIAS = [
  { IDPovincia: '01', Provincia: 'ARABA/ALAVA',        CCAA: 'Pais Vasco' },
  { IDPovincia: '02', Provincia: 'ALBACETE',           CCAA: 'Castilla-La Mancha' },
  { IDPovincia: '03', Provincia: 'ALICANTE',           CCAA: 'Comunidad Valenciana' },
  { IDPovincia: '04', Provincia: 'ALMERIA',            CCAA: 'Andalucia' },
  { IDPovincia: '33', Provincia: 'ASTURIAS',           CCAA: 'Principado de Asturias' },
  { IDPovincia: '05', Provincia: 'AVILA',              CCAA: 'Castilla y Leon' },
  { IDPovincia: '06', Provincia: 'BADAJOZ',            CCAA: 'Extremadura' },
  { IDPovincia: '07', Provincia: 'ILLES BALEARS',      CCAA: 'Illes Balears' },
  { IDPovincia: '08', Provincia: 'BARCELONA',          CCAA: 'Cataluna' },
  { IDPovincia: '48', Provincia: 'BIZKAIA',            CCAA: 'Pais Vasco' },
  { IDPovincia: '09', Provincia: 'BURGOS',             CCAA: 'Castilla y Leon' },
  { IDPovincia: '10', Provincia: 'CACERES',            CCAA: 'Extremadura' },
  { IDPovincia: '11', Provincia: 'CADIZ',              CCAA: 'Andalucia' },
  { IDPovincia: '39', Provincia: 'CANTABRIA',          CCAA: 'Cantabria' },
  { IDPovincia: '12', Provincia: 'CASTELLON',          CCAA: 'Comunidad Valenciana' },
  { IDPovincia: '51', Provincia: 'CEUTA',              CCAA: 'Ceuta' },
  { IDPovincia: '13', Provincia: 'CIUDAD REAL',        CCAA: 'Castilla-La Mancha' },
  { IDPovincia: '14', Provincia: 'CORDOBA',            CCAA: 'Andalucia' },
  { IDPovincia: '15', Provincia: 'A CORUNA',           CCAA: 'Galicia' },
  { IDPovincia: '16', Provincia: 'CUENCA',             CCAA: 'Castilla-La Mancha' },
  { IDPovincia: '20', Provincia: 'GIPUZKOA',           CCAA: 'Pais Vasco' },
  { IDPovincia: '17', Provincia: 'GIRONA',             CCAA: 'Cataluna' },
  { IDPovincia: '18', Provincia: 'GRANADA',            CCAA: 'Andalucia' },
  { IDPovincia: '19', Provincia: 'GUADALAJARA',        CCAA: 'Castilla-La Mancha' },
  { IDPovincia: '21', Provincia: 'HUELVA',             CCAA: 'Andalucia' },
  { IDPovincia: '22', Provincia: 'HUESCA',             CCAA: 'Aragon' },
  { IDPovincia: '23', Provincia: 'JAEN',               CCAA: 'Andalucia' },
  { IDPovincia: '24', Provincia: 'LEON',               CCAA: 'Castilla y Leon' },
  { IDPovincia: '25', Provincia: 'LLEIDA',             CCAA: 'Cataluna' },
  { IDPovincia: '27', Provincia: 'LUGO',               CCAA: 'Galicia' },
  { IDPovincia: '28', Provincia: 'MADRID',             CCAA: 'Comunidad de Madrid' },
  { IDPovincia: '29', Provincia: 'MALAGA',             CCAA: 'Andalucia' },
  { IDPovincia: '52', Provincia: 'MELILLA',            CCAA: 'Melilla' },
  { IDPovincia: '30', Provincia: 'MURCIA',             CCAA: 'Region de Murcia' },
  { IDPovincia: '31', Provincia: 'NAVARRA',            CCAA: 'Comunidad Foral de Navarra' },
  { IDPovincia: '32', Provincia: 'OURENSE',            CCAA: 'Galicia' },
  { IDPovincia: '34', Provincia: 'PALENCIA',           CCAA: 'Castilla y Leon' },
  { IDPovincia: '35', Provincia: 'PALMAS (LAS)',       CCAA: 'Canarias' },
  { IDPovincia: '36', Provincia: 'PONTEVEDRA',         CCAA: 'Galicia' },
  { IDPovincia: '26', Provincia: 'LA RIOJA',           CCAA: 'La Rioja' },
  { IDPovincia: '37', Provincia: 'SALAMANCA',          CCAA: 'Castilla y Leon' },
  { IDPovincia: '38', Provincia: 'SANTA CRUZ DE TENERIFE', CCAA: 'Canarias' },
  { IDPovincia: '40', Provincia: 'SEGOVIA',            CCAA: 'Castilla y Leon' },
  { IDPovincia: '41', Provincia: 'SEVILLA',            CCAA: 'Andalucia' },
  { IDPovincia: '42', Provincia: 'SORIA',              CCAA: 'Castilla y Leon' },
  { IDPovincia: '43', Provincia: 'TARRAGONA',          CCAA: 'Cataluna' },
  { IDPovincia: '44', Provincia: 'TERUEL',             CCAA: 'Aragon' },
  { IDPovincia: '45', Provincia: 'TOLEDO',             CCAA: 'Castilla-La Mancha' },
  { IDPovincia: '46', Provincia: 'VALENCIA',           CCAA: 'Comunidad Valenciana' },
  { IDPovincia: '47', Provincia: 'VALLADOLID',         CCAA: 'Castilla y Leon' },
  { IDPovincia: '49', Provincia: 'ZAMORA',             CCAA: 'Castilla y Leon' },
  { IDPovincia: '50', Provincia: 'ZARAGOZA',           CCAA: 'Aragon' }
];

function fillProvincias(sel, data) {
  data.sort(function(a, b) { return a.Provincia.localeCompare(b.Provincia); });
  data.forEach(function(p) {
    var o = document.createElement('option');
    o.value = p.IDPovincia;
    o.textContent = p.Provincia + ' (' + p.CCAA + ')';
    sel.appendChild(o);
  });
}

function loadProvincias() {
  // Siempre cargamos desde la constante hardcodeada - zero dependencia de API
  var sel = document.getElementById('sel-provincia');
  fillProvincias(sel, SPAIN_PROVINCIAS.slice());
}

// ---- CARGA DE MUNICIPIOS con cache localStorage por provincia ----
var MUN_KEY_PREFIX = 'gs_mun_v1_';
var MUN_TTL_FRESH  = 7  * 24 * 60 * 60 * 1000;
var MUN_TTL_STALE  = 30 * 24 * 60 * 60 * 1000;

function fillMunicipios(sel, data) {
  data.sort(function(a, b) { return a.Municipio.localeCompare(b.Municipio); });
  data.forEach(function(m) {
    var o = document.createElement('option');
    o.value = m.IDMunicipio;
    o.textContent = m.Municipio;
    sel.appendChild(o);
  });
  sel.disabled = false;
}

var municipalityRequest = 0;
async function loadMunicipios(idProv) {
  var request = ++municipalityRequest;
  var sel = document.getElementById('sel-municipio');
  sel.innerHTML = '<option value="">-- Todos --</option>';
  sel.disabled = true;
  if (!idProv) return;

  var key    = MUN_KEY_PREFIX + idProv;
  var cached = lsRead(key);
  var age    = cached ? Date.now() - cached.ts : Infinity;

  if (cached && age < MUN_TTL_FRESH) {
    fillMunicipios(sel, cached.data);
    return;
  }

  if (cached && age < MUN_TTL_STALE) {
    fillMunicipios(sel, cached.data);
    fetchJSON('/api/municipios/' + idProv).then(function(data) {
      lsWrite(key, data);
    }).catch(function() {});
    return;
  }

  try {
    var data = await fetchJSON('/api/municipios/' + idProv);
    lsWrite(key, data);
    if (request !== municipalityRequest || document.getElementById('sel-provincia').value !== idProv) return;
    fillMunicipios(sel, data);
  } catch(e) {
    if (request !== municipalityRequest || document.getElementById('sel-provincia').value !== idProv) return;
    if (cached) {
      fillMunicipios(sel, cached.data);
    } else {
      showToast('API del Ministerio no disponible. Puedes buscar por provincia sin municipio.', 'warning');
      sel.disabled = false;
    }
  }
}

function renderSkeletons(count) {
  var list = document.getElementById('station-list');
  list.setAttribute('aria-busy', 'true');
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<div class="skeleton-card" aria-hidden="true">'
         +   '<div class="sk-left">'
         +     '<div class="sk-line sk-title"></div>'
         +     '<div class="sk-line sk-sub"></div>'
         +     '<div class="sk-line sk-time"></div>'
         +   '</div>'
         +   '<div class="sk-badge"></div>'
         + '</div>';
  }
  list.innerHTML = html;
}

var stationRequest = 0;
var currentSnapshotDate = '';
function stationSelectionKey() {
  return searchOrigin ? 'near:' + searchOrigin.lat + ',' + searchOrigin.lng
    : document.getElementById('sel-provincia').value + '|' + document.getElementById('sel-municipio').value + '|' + getSearchArea();
}
async function loadStations(options) {
  options = options || {};
  var request = ++stationRequest;
  var selection = stationSelectionKey();
  var idProv = document.getElementById('sel-provincia').value;
  var idMunSel = document.getElementById('sel-municipio').value;
  var nearby = !!searchOrigin || (!!idMunSel && getSearchArea() === 'cerca');
  function isCurrent() { return request === stationRequest && selection === stationSelectionKey(); }
  if (!idProv && !nearby) { showToast('Selecciona una provincia primero', 'warning'); return false; }
  var key = cacheKey(nearby ? 'near' : idProv, '');
  var cached = getCache(key);
  function paint(stations, fecha, ts, stale) {
    if (!isCurrent()) return;
    allStations = stations;
    currentSnapshotDate = fecha || '';
    setupMunicipioRadio(!!idMunSel, idMunSel);
    showCacheIndicator(ts, stale, fecha);
    applyFilters();
  }
  if (cached && options.force !== true) {
    var stale = Date.now() - cached.ts > 2 * 60 * 60 * 1000;
    paint(cached.data, cached.fecha, cached.ts, stale);
    document.getElementById('loading').classList.remove('show');
    if (stale) return loadStations({ force: true, background: true });
    return true;
  }
  if (!options.background) {
    document.getElementById('stats-bar').style.display = 'none';
    renderSkeletons(6);
    document.getElementById('loading').classList.add('show');
  }
  try {
    var url = nearby ? '/data/stations.json' : '/api/estaciones/provincia/' + idProv;
    var data = await fetchJSON(url, options.force ? { cache: 'no-store' } : undefined);
    if (!data || !Array.isArray(data.ListaEESSPrecio)) throw new Error('Respuesta de precios incompleta');
    var stations = data.ListaEESSPrecio.map(normalizeStation);
    if (!isCurrent()) return false;
    setCache(key, stations, data.Fecha || '');
    paint(stations, data.Fecha || '', Date.now(), false);
    return true;
  } catch(err) {
    if (!isCurrent()) return false;
    console.error(err);
    var stale = getCache(key, true);
    if (stale) {
      paint(stale.data, stale.fecha, stale.ts, true);
      showToast('No se pudo actualizar. Mostrando la copia guardada ' + formatAge(stale.ts) + '.', 'warning');
    } else {
      showListError('No hemos podido cargar los precios ahora mismo. Vuelve a intentarlo en unos minutos.');
      showToast('No se pudieron cargar los precios. Reintenta en unos minutos.', 'error');
    }
    return false;
  } finally {
    if (request === stationRequest) document.getElementById('loading').classList.remove('show');
  }
}

// ---- NORMALIZACION DE CADENAS (compartida con favoritas: provinciaIdByName) ----
function normStr(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ============================================================
// Ship 21: PULL-TO-REFRESH (solo touch)
// ============================================================
// Gesto nativo: el usuario tira hacia abajo desde arriba de la lista cuando
// scrollTop=0. Si la distancia tirada supera PTR_THRESHOLD px, al soltar se
// dispara forceReload() (misma logica que el boton "Actualizar" del stale
// indicator). Visualmente, un indicador colapsado se expande conforme el
// usuario tira, la flecha rota a 180deg al pasar el umbral, y al soltar se
// anima el spinner mientras dura el fetch.
//
// Decisiones:
//  - Solo touch (detectado via ontouchstart o maxTouchPoints). En desktop el
//    usuario tiene los botones "Buscar" y "Actualizar" — el gesto carece de
//    sentido.
//  - Si no hay provincia seleccionada, no hace nada (forceReload es no-op).
//  - touchmove usa passive:false solo cuando hace falta preventDefault (tirar
//    hacia abajo desde scrollTop=0). En otros casos, passive:true para no
//    romper el scroll nativo.
//  - Escucha directamente en #station-list, no en window — no interferimos
//    con otros gestos (abrir/cerrar sidebar en movil, etc.).
(function() {
  var list = document.getElementById('station-list');
  var indicator = document.getElementById('ptr-indicator');
  if (!list || !indicator) return;
  // Solo dispositivos touch
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
  if (!isTouch) return;

  var PTR_THRESHOLD = 70;   // px minimos para disparar refresh
  var PTR_MAX       = 110;  // px max que el indicador se expande (con elasticidad)
  var PTR_REFRESH_H = 52;   // altura visible mientras refresca

  var startY = 0, currDelta = 0, pulling = false, refreshing = false;
  var arrow = indicator.querySelector('.ptr-arrow');
  var text  = indicator.querySelector('.ptr-text');

  function setHeight(h) {
    indicator.style.height = h > 0 ? (h + 'px') : '';
  }
  function reset() {
    indicator.classList.remove('ready');
    setHeight(0);
    if (text) text.textContent = 'Tira para actualizar';
  }

  list.addEventListener('touchstart', function(e) {
    if (refreshing || !e.touches || !e.touches.length) return;
    if (list.scrollTop > 0) { pulling = false; return; }
    startY = e.touches[0].clientY;
    currDelta = 0;
    pulling = true;
    // Sin transition durante el drag — que siga el dedo al ms
    indicator.style.transition = 'none';
  }, { passive: true });

  list.addEventListener('touchmove', function(e) {
    if (!pulling || refreshing || !e.touches || !e.touches.length) return;
    var delta = e.touches[0].clientY - startY;
    if (delta <= 0) {
      currDelta = 0;
      setHeight(0);
      indicator.classList.remove('ready');
      return;
    }
    // Elasticidad: al acercarnos a PTR_MAX, reducimos la ganancia para que se
    // sienta gomoso. delta lineal hasta ~70% de PTR_MAX, luego asintotico.
    var h;
    if (delta <= PTR_MAX * 0.7) {
      h = delta;
    } else {
      var over = delta - PTR_MAX * 0.7;
      h = PTR_MAX * 0.7 + (over * 0.4);
      if (h > PTR_MAX) h = PTR_MAX;
    }
    currDelta = h;
    setHeight(h);
    if (h >= PTR_THRESHOLD) {
      indicator.classList.add('ready');
      if (text) text.textContent = 'Suelta para actualizar';
    } else {
      indicator.classList.remove('ready');
      if (text) text.textContent = 'Tira para actualizar';
    }
    // Bloquear el "overscroll" del navegador (que rebotaria la pagina)
    if (e.cancelable) {
      try { e.preventDefault(); } catch(_) {}
    }
  }, { passive: false });

  list.addEventListener('touchend', function() {
    if (!pulling) return;
    pulling = false;
    // Restaurar transition para el snap-back / mantenimiento
    indicator.style.transition = '';
    if (currDelta >= PTR_THRESHOLD && !refreshing) {
      // Mantener visible mientras refresca
      refreshing = true;
      indicator.classList.remove('ready');
      indicator.classList.add('refreshing');
      if (text) text.textContent = 'Actualizando...';
      setHeight(PTR_REFRESH_H);
      Promise.resolve().then(forceReload).finally(function() {
        indicator.classList.remove('refreshing');
        reset();
        refreshing = false;
      });
    } else {
      reset();
    }
  }, { passive: true });

  // Si el usuario cancela el toque (salta llamada telefono, etc.), restauramos.
  list.addEventListener('touchcancel', function() {
    if (!pulling) return;
    pulling = false;
    indicator.style.transition = '';
    reset();
  }, { passive: true });
})();
