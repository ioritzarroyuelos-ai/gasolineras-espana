export const clientFeaturesScript = `
// ---- TREND STRIP (tendencia nacional hoy vs ciclo anterior) ----
// Lee /data/trends.json (generado por scripts/fetch-prices.mjs cada cron) y
// pinta un strip horizontal con medianas nacionales de gasolina 95 + gasoleo A
// mas delta vs la ejecucion anterior. Se oculta si no hay "previous" (primera
// ejecucion) o si el usuario lo descarto en este ciclo (recordamos la
// dismissal anclada al ministryDate para que vuelva a aparecer al dia
// siguiente con nuevos datos).
(function() {
  var strip  = document.getElementById('trend-strip');
  if (!strip) return;
  var g95El  = document.getElementById('trend-g95');
  var dslEl  = document.getElementById('trend-diesel');
  var closer = document.getElementById('trend-strip-close');
  var DISMISS_KEY = 'gs_trend_dismiss_v1';

  function fmtPrice(v) { return v == null ? '--' : v.toFixed(3) + ' \u20AC'; }
  function fmtDelta(d) {
    if (d == null) return '';
    // Mostramos en centimos porque el delta inter-ciclo es de decimas de cent.
    var cents = d * 100;
    var abs = Math.abs(cents);
    if (abs < 0.5) return '<span class="dlt dlt-flat">\u2194 sin cambio</span>';
    var arrow = cents < 0 ? '\u2193' : '\u2191';
    var cls = cents < 0 ? 'dlt-down' : 'dlt-up';
    return '<span class="dlt ' + cls + '">' + arrow + ' ' + abs.toFixed(1) + 'c</span>';
  }
  function paint(label, curr, prev, node) {
    if (curr == null) { node.textContent = ''; return false; }
    var delta = (prev != null) ? (curr - prev) : null;
    node.innerHTML = label + ' <b>' + fmtPrice(curr) + '</b> ' + fmtDelta(delta);
    return true;
  }

  try {
    fetch('/data/trends.json', { cache: 'no-store' }).then(function(r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function(data) {
      if (!data || !data.current) return;
      // No mostramos el strip hasta tener un "previous" (primera ejecucion
      // del cron no tiene con que comparar).
      if (!data.previous) return;
      var curr = data.current.medians || {};
      var prev = data.previous.medians || {};
      // Dismissal: si el usuario cerro este mismo snapshot, respetamos.
      var dismissed = '';
      try { dismissed = localStorage.getItem(DISMISS_KEY) || ''; } catch(_) {}
      if (dismissed && dismissed === (data.ministryDate || '')) return;

      var any = false;
      any = paint('G95:',   curr.g95,    prev.g95,    g95El) || any;
      any = paint('Di\u00E9sel:', curr.diesel, prev.diesel, dslEl) || any;
      if (any) strip.hidden = false;
    }).catch(function() { /* silenciar — strip es opcional */ });
  } catch(_) {}

  if (closer) {
    closer.addEventListener('click', function() {
      strip.hidden = true;
      // Ancla la dismissal al ministryDate activo: al dia siguiente, cuando
      // cambie el snapshot, volvera a aparecer.
      try {
        fetch('/data/trends.json', { cache: 'no-store' }).then(function(r) {
          return r.ok ? r.json() : null;
        }).then(function(data) {
          if (!data) return;
          try { localStorage.setItem(DISMISS_KEY, data.ministryDate || ''); } catch(_) {}
        }).catch(function(){});
      } catch(_) {}
    });
  }
})();

// ---- WATCHDOG DE FRESCURA ----
// Si /api/health devuelve 503, significa que el snapshot del Ministerio
// lleva >24h sin actualizarse (o falta meta). Mostramos un banner amarillo
// no-intrusivo para que el usuario sepa que los precios pueden estar
// desfasados. Tambien lo mostramos si el endpoint da otro error de red
// persistente (offline prolongado) para avisar de la posible discrepancia.
//
// Se ejecuta una vez al cargar + al volver del background (visibilitychange),
// con un throttle de 5 minutos para no martillear la salud en tabs zombis.
(function() {
  var LAST = 0;
  var MIN_INTERVAL_MS = 5 * 60 * 1000;
  function checkHealth() {
    var now = Date.now();
    if (now - LAST < MIN_INTERVAL_MS) return;
    LAST = now;
    try {
      fetch('/api/health', { cache: 'no-store' }).then(function(r) {
        var banner = document.getElementById('stale-banner');
        if (!banner) return;
        // 503 === snapshot stale. 200 === fresco. Cualquier otro estado no
        // es concluyente → no tocamos el banner (evita falsos positivos).
        if (r.status === 503) banner.classList.add('show');
        else if (r.status === 200) banner.classList.remove('show');
      }).catch(function() {
        // Red caida: no mostramos stale (el offline-banner ya cubre ese caso).
      });
    } catch(_) {}
  }
  // Primera comprobacion diferida 3s para no competir con carga inicial.
  setTimeout(checkHealth, 3000);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) checkHealth();
  });
})();

// ---- TELEMETRIA MINIMA DE ERRORES ----
// Reporta errores JS al endpoint /api/ingest. Sin PII, sin cookies. Rate-limited
// server-side. Localmente el usuario puede desactivar bloqueando esa ruta.
(function() {
  var sent = 0;
  var MAX_PER_SESSION = 5;
  function report(payload) {
    if (sent >= MAX_PER_SESSION) return;
    sent++;
    try {
      // Turnstile: si hay token (widget invisible resuelto), lo adjuntamos
      // en el body como "ts". sendBeacon no permite headers personalizados,
      // por eso va en el payload. Si no hay token (dev / widget aun sin
      // resolver / bloqueado), el servidor hace fail-open si tampoco hay
      // secret configurado.
      try {
        var tok = (window).__TS_TOKEN__;
        if (typeof tok === 'string' && tok) payload.ts = tok;
      } catch(_) {}
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/api/ingest', blob);
      } else {
        fetch('/api/ingest', { method:'POST', headers:{'Content-Type':'application/json'}, body: body, keepalive: true })
          .catch(function(){});
      }
    } catch(_) {}
  }
  window.addEventListener('error', function(e) {
    report({
      msg: e && e.message ? String(e.message) : 'error',
      src: e && e.filename ? String(e.filename) : undefined,
      line: e && typeof e.lineno === 'number' ? e.lineno : undefined,
      col:  e && typeof e.colno  === 'number' ? e.colno  : undefined,
      stk: (e && e.error && e.error.stack) ? String(e.error.stack) : undefined,
      url: location.pathname,
      ver: APP_VER
    });
  });
  window.addEventListener('unhandledrejection', function(e) {
    var r = e && e.reason;
    report({
      msg: 'unhandledrejection: ' + (r && r.message ? r.message : String(r)),
      stk: (r && r.stack) ? String(r.stack) : undefined,
      url: location.pathname,
      ver: APP_VER
    });
  });
})();

// ============================================================
// ===== COMPARADOR SIDE-BY-SIDE =====
// ============================================================
// Wiring del modal y chip flotante. La logica de estado (compareIds,
// toggleCompare, renderCompareModal) vive arriba — aqui solo enchufamos
// los listeners al DOM tras cargar el script.
(function() {
  var modal  = document.getElementById('modal-compare');
  if (!modal) return;
  var btnClose = document.getElementById('btn-compare-close');
  var btnClear = document.getElementById('btn-compare-clear');
  var btnDone  = document.getElementById('btn-compare-done');
  var chip     = document.getElementById('compare-chip');
  var chipX    = document.getElementById('compare-chip-clear');

  if (btnClose) btnClose.addEventListener('click', closeCompareModal);
  if (btnDone)  btnDone.addEventListener('click',  closeCompareModal);
  // "Quitar seleccion" limpia compareIds pero deja abierto el modal (por si
  // el usuario quiere seguir comparando otras; ahora solo vera el empty state).
  if (btnClear) btnClear.addEventListener('click', function() {
    clearCompareSelection();
    renderCompareModal();
    showToast('Seleccion del comparador vaciada', 'info');
  });
  // Click en el chip flotante -> abre modal (si hay al menos 1 estacion).
  // El X dentro del chip limpia la seleccion en su lugar.
  if (chip) chip.addEventListener('click', function(e) {
    if (e.target && e.target.closest && e.target.closest('.compare-chip-x')) return;
    if (compareIds.length > 0) openCompareModal();
  });
  if (chipX) chipX.addEventListener('click', function(e) {
    e.stopPropagation();
    clearCompareSelection();
    showToast('Seleccion del comparador vaciada', 'info');
  });
  // Cerrar con click fuera del modal (backdrop) — patron comun con los otros
  // modales (onboarding/favoritos/diario). El click dentro del .modal burbujeara
  // hasta el backdrop tambien, asi que comprobamos que el target sea el propio.
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeCompareModal();
  });
  // Cerrar con ESC (accesibilidad basica).
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeCompareModal();
  });
})();

// ============================================================
// Ship 22: SWIPE-DOWN-TO-DISMISS para bottom sheets (movil)
// ============================================================
// Cuando el modal se muestra como bottom sheet (width <= 639px), el usuario
// espera poder cerrarlo arrastrando hacia abajo. Delegamos en document para
// cubrir todos los modales (.modal-backdrop.show) sin duplicar logica.
// Solo engancha cuando el modal-body esta en scrollTop=0 (asi el scroll
// interno sigue funcionando cuando hay contenido largo).
(function() {
  var activeModal = null;
  var startY = 0, currDelta = 0, dragging = false;

  function isMobile() {
    return window.innerWidth <= 639;
  }
  function findModal(target) {
    if (!target || !target.closest) return null;
    var backdrop = target.closest('.modal-backdrop.show');
    if (!backdrop) return null;
    var modal = backdrop.querySelector('.modal');
    return modal ? { backdrop: backdrop, modal: modal } : null;
  }
  function canDrag(modal, target) {
    // Si el usuario toca DENTRO de modal-body y este tiene scroll hacia abajo,
    // el gesto es "scroll interno", no "cerrar sheet". Solo dejamos arrastrar
    // cuando el contenido esta arriba del todo.
    if (modal.scrollTop > 0) return false;
    // Evitar conflicto con form fields, sliders, etc.
    if (target && target.closest) {
      if (target.closest('input, textarea, select, button, [role="slider"], [data-hist-range], .hist-toggle')) return false;
    }
    return true;
  }

  document.addEventListener('touchstart', function(e) {
    if (!isMobile()) return;
    var found = findModal(e.target);
    if (!found) return;
    if (!canDrag(found.modal, e.target)) return;
    activeModal = found;
    startY = e.touches[0].clientY;
    currDelta = 0;
    dragging = true;
    found.modal.style.transition = 'none';
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!dragging || !activeModal) return;
    var delta = e.touches[0].clientY - startY;
    if (delta <= 0) {
      currDelta = 0;
      activeModal.modal.style.transform = '';
      return;
    }
    currDelta = delta;
    activeModal.modal.style.transform = 'translateY(' + delta + 'px)';
    // Atenuar el backdrop conforme se arrastra para dar feedback
    var opacity = Math.max(0.2, 1 - (delta / 400));
    activeModal.backdrop.style.background = 'rgba(15,23,42,' + (opacity * 0.6).toFixed(3) + ')';
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!dragging || !activeModal) return;
    dragging = false;
    activeModal.modal.style.transition = '';
    activeModal.backdrop.style.background = '';
    if (currDelta > 120) {
      // Cerrar: slide completo hacia abajo y remover .show
      activeModal.modal.style.transform = 'translateY(100%)';
      var backdrop = activeModal.backdrop;
      setTimeout(function() {
        backdrop.classList.remove('show');
        backdrop.querySelector('.modal').style.transform = '';
      }, 220);
    } else {
      // Snap back
      activeModal.modal.style.transform = '';
    }
    activeModal = null;
    currDelta = 0;
  }, { passive: true });

  document.addEventListener('touchcancel', function() {
    if (!dragging || !activeModal) return;
    dragging = false;
    activeModal.modal.style.transition = '';
    activeModal.modal.style.transform = '';
    activeModal.backdrop.style.background = '';
    activeModal = null;
    currDelta = 0;
  }, { passive: true });
})();

// ---- Ship 20: wiring del modal de historico ----
// Mismo patron que comparador: botones close/done + click backdrop + ESC.
// openHistoryModal se dispara desde ui.ts al clicar el boton 📈 de una card.
(function() {
  var modal = document.getElementById('modal-history');
  if (!modal) return;
  var btnClose = document.getElementById('btn-history-close');
  var btnDone  = document.getElementById('btn-history-done');
  if (btnClose) btnClose.addEventListener('click', closeHistoryModal);
  if (btnDone)  btnDone.addEventListener('click',  closeHistoryModal);
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeHistoryModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeHistoryModal();
  });
})();

// ---- Ship 8: REPORTE DE PRECIO INCORRECTO ----
// Un solo IIFE que:
//  1. Delega clicks en .popup-report-link del mapa (data-pop-report contiene
//     ideess|fuel|officialPrice|rotulo).
//  2. Expone openReportModal(...) por si otros contextos (lista, favoritos)
//     quieren abrirlo en el futuro — por ahora solo el popup del mapa.
//  3. Maneja el submit: valida, POST a /api/reports/price, muestra toast y
//     cierra. Errores (429/409/500) se muestran inline sin cerrar para que
//     el usuario pueda reintentar.
(function() {
  var modal = document.getElementById('modal-report');
  if (!modal) return;
  var ctxBox    = document.getElementById('report-context');
  var selReason = document.getElementById('report-reason');
  var inPrice   = document.getElementById('report-price');
  var inComment = document.getElementById('report-comment');
  var statusEl  = document.getElementById('report-status');
  var btnClose  = document.getElementById('btn-report-close');
  var btnCancel = document.getElementById('btn-report-cancel');
  var btnSubmit = document.getElementById('btn-report-submit');

  // Estado del modal actual (resetea en openReportModal).
  var current = { ideess: '', fuel: '', officialPrice: null, rotulo: '' };

  // Mapeo de codigos internos a etiquetas usuario-friendly. Usamos los mismos
  // codigos cortos que emite map.ts (REPORT_FUEL_CODES) y que el servidor
  // valida contra REPORT_FUELS en src/index.tsx.
  var FUEL_LABELS = {
    '95': 'Gasolina 95',
    '98': 'Gasolina 98',
    'diesel': 'Di\u00E9sel A',
    'diesel_plus': 'Di\u00E9sel Plus',
    'glp': 'GLP (autogas)',
    'gnc': 'GNC',
    'gnl': 'GNL',
    'hidrogeno': 'Hidr\u00F3geno',
    'diesel_renov': 'Di\u00E9sel Renovable'
  };

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    if (isError) statusEl.classList.add('error');
    else statusEl.classList.remove('error');
  }

  function closeReport() {
    modal.classList.remove('show');
    setStatus('', false);
  }

  function openReportModal(ideess, fuel, officialPrice, rotulo) {
    current.ideess = String(ideess || '').trim();
    current.fuel = String(fuel || '').trim();
    current.officialPrice = (typeof officialPrice === 'number' && isFinite(officialPrice)) ? officialPrice : null;
    current.rotulo = String(rotulo || 'Gasolinera').trim();

    // Caja contextual con lo que el usuario va a reportar.
    var fuelLabel = FUEL_LABELS[current.fuel] || current.fuel;
    var priceTxt  = current.officialPrice != null
      ? current.officialPrice.toFixed(3) + ' \u20AC/L'
      : 'sin precio publicado';
    if (ctxBox) {
      ctxBox.innerHTML = 'Reportando <strong>' + esc(current.rotulo) + '</strong>'
                      + ' &middot; <strong>' + esc(fuelLabel) + '</strong>'
                      + ' &middot; oficial: <strong>' + esc(priceTxt) + '</strong>';
    }

    // Reset campos a valores por defecto cada vez que se abre — evita que el
    // usuario reporte por error la estacion X con el comentario de la Y.
    if (selReason) selReason.value = 'outdated';
    if (inPrice) inPrice.value = '';
    if (inComment) inComment.value = '';
    setStatus('', false);
    if (btnSubmit) btnSubmit.disabled = false;

    modal.classList.add('show');
    setTimeout(function() { selReason && selReason.focus(); }, 50);
  }

  // Exponer globalmente por si otros modulos quieren abrirlo.
  window.openReportModal = openReportModal;

  // Delegacion de clicks en popup-report-link del mapa. El data-pop-report
  // codifica "ideess|fuel|price|rotulo" (| como separador, rotulo puede
  // contener espacios pero no | — si acaso contuviera, join('|') al desempaquetar
  // lo reabsorberia en la parte del rotulo; cubrimos ese caso con slice(3).join).
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest('[data-pop-report]');
    if (!btn) return;
    var payload = btn.getAttribute('data-pop-report') || '';
    var parts = payload.split('|');
    if (parts.length < 4) return;
    var ideess = parts[0];
    var fuel = parts[1];
    var price = parseFloat(parts[2]);
    var rotulo = parts.slice(3).join('|');
    openReportModal(ideess, fuel, isFinite(price) ? price : null, rotulo);
  });

  if (btnClose)  btnClose.addEventListener('click',  closeReport);
  if (btnCancel) btnCancel.addEventListener('click', closeReport);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeReport(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeReport();
  });

  // Submit: validacion client-side ligera + POST. El servidor re-valida todo
  // (ver /api/reports/price), asi que aqui solo cortamos los casos obvios
  // para dar feedback inmediato.
  if (btnSubmit) btnSubmit.addEventListener('click', async function() {
    if (!current.ideess || !current.fuel) {
      setStatus('Falta la estaci\u00F3n o el combustible.', true);
      return;
    }
    var reason = selReason ? selReason.value : '';
    if (!reason) {
      setStatus('Elige un motivo.', true);
      return;
    }

    // Precio opcional — parseo tolerante (coma o punto decimal).
    var priceRaw = inPrice ? inPrice.value.trim() : '';
    var reportedPrice = null;
    if (priceRaw) {
      var n = parseFloat(priceRaw.replace(',', '.'));
      if (!isFinite(n) || n < 0.1 || n > 10) {
        setStatus('El precio debe estar entre 0,10 y 10,00 \u20AC/L.', true);
        return;
      }
      reportedPrice = n;
    }
    var comment = inComment ? inComment.value.trim() : '';
    if (comment.length > 500) comment = comment.slice(0, 500);

    btnSubmit.disabled = true;
    setStatus('Enviando reporte\u2026', false);

    try {
      var r = await fetch('/api/reports/price', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ideess: current.ideess,
          fuel: current.fuel,
          officialPriceEur: current.officialPrice,
          reportedPriceEur: reportedPrice,
          reason: reason,
          comment: comment || null
        })
      });
      if (r.ok) {
        closeReport();
        showToast('Gracias \u2014 reporte enviado', 'success');
        return;
      }
      if (r.status === 429) {
        setStatus('Has enviado demasiados reportes. Espera un momento.', true);
      } else if (r.status === 409) {
        setStatus('Ya reportaste esta estaci\u00F3n en la \u00FAltima hora. Gracias.', true);
      } else if (r.status === 400 || r.status === 413 || r.status === 415) {
        setStatus('Datos no v\u00E1lidos. Revisa los campos y prueba de nuevo.', true);
      } else {
        setStatus('No se pudo enviar el reporte. Prueba en unos segundos.', true);
      }
      btnSubmit.disabled = false;
    } catch (err) {
      setStatus('Fallo de red. Comprueba tu conexi\u00F3n y prueba de nuevo.', true);
      btnSubmit.disabled = false;
    }
  });
})();

`
