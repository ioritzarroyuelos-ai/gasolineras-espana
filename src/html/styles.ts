// Recibe el nonce CSP por parametro. El <style> inline debe llevar el mismo
// nonce que esta en el header Content-Security-Policy para ejecutarse sin
// 'unsafe-inline' en style-src. Si el caller pasa '' (p.ej. preview offline)
// se omite el atributo — el bloque entonces solo cargara si la CSP aun
// permite 'unsafe-inline', lo que no ocurre en el flujo normal de la app.
export function getStyles(nonce: string = ''): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : ''
  return `<style${nonceAttr}>
    /* ===== RESET & BASE ===== */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    /* Scroll vertical habilitado en body (antes era overflow:hidden en html/body
       lo que hacia el contenido SEO bajo el app inalcanzable — ver .seo-summary
       / .seo-faq / .seo-municipios). Ahora el "primer pliegue" sigue siendo el
       app (header + app-body fijos al viewport) y el resto queda below-fold
       accesible por scroll normal. overflow-x:hidden evita scroll horizontal
       accidental por algun elemento que rebase (leaflet tile buffer, etc.). */
    html { height: 100%; }
    body {
      min-height: 100%;
      width: 100%;
      overflow-x: hidden;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #f8fafc;
      /* padding-top reserva el espacio del header fijo para que el resto del
         contenido (app-body + secciones SEO) no quede oculto debajo. */
      padding-top: 60px;
    }

    /* ===== LAYOUT PRINCIPAL ===== */
    #app-header {
      position: fixed; top: 0; left: 0; right: 0;
      height: 60px; z-index: 1000;
      background: linear-gradient(135deg, #14532d 0%, #166534 40%, #16a34a 100%);
      display: flex; align-items: center; padding: 0 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25);
    }
    /* app-body ocupa exactamente 1 viewport menos el header => primera pantalla
       = mapa + sidebar a pantalla completa. Al scrollear, el usuario ve el
       contenido SEO debajo (FAQ, tabla de precios por ambito, municipios). */
    #app-body {
      position: relative;
      height: calc(100vh - 60px);
      display: flex; overflow: hidden;
    }

    /* ===== SIDEBAR ===== */
    #sidebar {
      width: 288px; min-width: 288px;
      background: #fff;
      border-right: 1px solid #e2e8f0;
      display: flex; flex-direction: column;
      overflow: hidden;
      box-shadow: 2px 0 8px rgba(0,0,0,0.06);
      z-index: 100;
    }
    /* Ship 25.3 — Sidebar filters NO debe dominar el alto del sidebar.
       Antes: flex-shrink:0 + overflow-y:auto hacia que cuando el usuario
       abria "Filtros avanzados", tenia el deposito, el widget de gasto
       mensual y el boton Ko-fi renderizados, sidebar-filters crecia a
       ~600-700px y station-list se quedaba con ~85px (sin aire visible
       para las gasolineras). Con max-height:60% + flex:0 1 auto, los
       filtros se auto-limitan a 60% del alto del sidebar (scroll interno
       si hace falta) y station-list siempre tiene al menos un 40% de
       espacio vertical — minimo garantizado via min-height:180px. */
    #sidebar-filters {
      padding: 12px; background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      overflow-y: auto;
      flex: 0 1 auto;
      max-height: 60%;
    }
    #stats-bar {
      padding: 8px 12px; background: #f0fdf4;
      border-bottom: 1px solid #bbf7d0;
      flex-shrink: 0; display: none;
    }
    #station-list {
      flex: 1 1 auto; min-height: 180px; overflow-y: auto;
    }
    /* Ship 21: pull-to-refresh.
       El indicador esta colapsado (height:0) por defecto. El listener touch
       en list.ts le asigna una altura inline durante el gesto (hasta PTR_MAX
       px). Al soltar, vuelve a 0 (via transition) o queda en 60px mientras
       dura el refresh. La flecha rota 180deg cuando se supera el threshold
       para senalar que soltar ahora dispara el refresh.
       Con prefers-reduced-motion, la transition se anula (sigue funcional
       pero sin el "rubber band" animado). */
    .ptr-indicator {
      height: 0; overflow: hidden;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      background: linear-gradient(180deg, #f0f9ff 0%, #f8fafc 100%);
      color: #64748b; font-size: 13px; font-weight: 500;
      border-bottom: 1px solid transparent; flex-shrink: 0;
      transition: height 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
      will-change: height;
    }
    .ptr-indicator.refreshing { border-bottom-color: #bae6fd; }
    .ptr-arrow {
      font-size: 16px; color: #0284c7;
      transition: transform 0.2s ease;
      display: inline-block; line-height: 1;
    }
    .ptr-indicator.ready .ptr-arrow { transform: rotate(180deg); }
    .ptr-indicator.refreshing .ptr-arrow {
      animation: ptr-spin 0.8s linear infinite;
    }
    @keyframes ptr-spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    body.dark .ptr-indicator {
      background: linear-gradient(180deg, #0c4a6e 0%, #1e293b 100%);
      color: #94a3b8;
    }
    body.dark .ptr-arrow { color: #38bdf8; }
    @media (prefers-reduced-motion: reduce) {
      .ptr-indicator, .ptr-arrow { transition: none; }
      .ptr-indicator.refreshing .ptr-arrow { animation: none; }
    }

    /* ===== MAPA ===== */
    /* z-index: 0 crea un stacking context — evita que los controles internos
       de Leaflet (.leaflet-control con z-index:1000) escapen y tapen al
       sidebar cuando se abre en overlay en movil. */
    #map-container {
      flex: 1; position: relative; overflow: hidden;
      z-index: 0;
    }
    #map {
      position: absolute; inset: 0;
      width: 100% !important; height: 100% !important;
    }

    /* ===== FORM CONTROLS ===== */
    .form-label { display:block; font-size:11px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px; }
    .form-select, .form-input {
      width: 100%; border: 1px solid #cbd5e1; border-radius: 8px;
      padding: 6px 10px; font-size: 13px; background: #fff;
      outline: none; transition: border-color 0.15s, box-shadow 0.15s;
      color: #1e293b;
    }
    .form-select:focus, .form-input:focus { border-color: #16a34a; box-shadow: 0 0 0 3px rgba(22,163,74,0.15); }
    .form-select:disabled { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; }
    .form-group { margin-bottom: 10px; }
    /* Pequena anotacion junto al label (p.ej. "opcional"). Ship 8. */
    .form-hint { font-weight: 400; font-size: 10px; color: #94a3b8; text-transform: none; letter-spacing: 0; margin-left: 4px; }
    body.dark .form-hint { color: #64748b; }
    .input-icon-wrap { position: relative; }
    .input-icon-wrap .icon { position:absolute; left:9px; top:50%; transform:translateY(-50%); color:#94a3b8; font-size:11px; }
    .input-icon-wrap .form-input { padding-left: 28px; }

    /* ===== AUTOCOMPLETADO BÚSQUEDA ===== */
    #search-suggestions {
      display: none; position: absolute; left: 0; right: 0; top: calc(100% + 4px);
      background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.12); z-index: 600;
      max-height: 220px; overflow-y: auto;
    }
    #search-suggestions.show { display: block; }
    .suggest-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9;
      transition: background 0.1s;
    }
    .suggest-item:last-child { border-bottom: none; }
    .suggest-item:hover { background: #f0fdf4; }
    .suggest-name { font-size: 13px; font-weight: 600; color: #1e293b; }
    .suggest-sub  { font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .suggest-price { flex-shrink: 0; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 20px; color: #fff; }
    body.dark #search-suggestions { background: #1e293b; border-color: #334155; }
    body.dark .suggest-item { border-bottom-color: #334155; }
    body.dark .suggest-item:hover { background: #334155; }
    body.dark .suggest-name { color: #f1f5f9; }
    body.dark .suggest-sub { color: #64748b; }

    /* ===== BOTONES ===== */
    .btn-primary {
      background: #15803d; color: #fff; border: none; border-radius: 8px;
      padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      transition: background 0.15s; display:inline-flex; align-items:center; gap:6px;
    }
    .btn-primary:hover { background: #166534; }
    .btn-primary:active { background: #14532d; }
    .btn-icon { background:none; border:none; cursor:pointer; color:#16a34a; font-size:15px; padding:4px; transition:color 0.15s; }
    .btn-icon:hover { color: #15803d; }

    /* ===== BADGES PRECIO ===== */
    .badge { display:inline-block; border-radius:9999px; padding:2px 9px; font-weight:700; font-size:12px; color:#fff; white-space:nowrap; }
    .badge-green  { background: #16a34a; }
    .badge-yellow { background: #d97706; }
    .badge-red    { background: #dc2626; }
    .badge-gray   { background: #9ca3af; }

    /* ===== STAT CHIPS ===== */
    .stat-chip { background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; border-radius:6px; padding:2px 8px; font-size:11px; font-weight:600; }
    .stat-chip.red    { background:#fef2f2; color:#dc2626; border-color:#fecaca; }
    .stat-chip.yellow { background:#fffbeb; color:#d97706; border-color:#fde68a; }

    /* ===== TARJETAS LISTA ===== */
    .station-card { cursor:pointer; transition:background 0.12s; border-bottom:1px solid #f1f5f9; padding:10px 12px; }
    .station-card:hover  { background: #f0fdf4; }
    .station-card.active { background: #dcfce7; border-left: 3px solid #16a34a; padding-left: 9px; }
    .card-title   { font-size:13px; font-weight:600; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .card-sub     { font-size:11px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
    .card-time    { font-size:10px; color:#94a3b8; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    /* ===== EMPTY STATE ===== */
    /* Empty state: el color base era #94a3b8 que falla contraste WCAG AA
       (2.56:1) para el <small>. Usamos #64748b que pasa (4.6:1) y armoniza
       con el <p> que ya usaba ese valor. */
    .empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:24px; color:#64748b; }
    .empty-state .icon { font-size:48px; margin-bottom:12px; color:#94a3b8; }
    .empty-state p { font-size:14px; font-weight:500; color:#64748b; }
    .empty-state small { font-size:12px; margin-top:4px; color:#64748b; }

    /* ===== LOADING OVERLAY ===== */
    #loading {
      position:absolute; inset:0; background:rgba(255,255,255,0.8);
      backdrop-filter:blur(4px); display:none;
      align-items:center; justify-content:center; z-index:500;
    }
    #loading.show { display:flex; }
    .loading-box { background:#fff; border-radius:16px; box-shadow:0 8px 32px rgba(0,0,0,0.12); padding:24px 32px; display:flex; flex-direction:column; align-items:center; gap:12px; }
    .spinner { border:3px solid #e5e7eb; border-top:3px solid #16a34a; border-radius:50%; width:36px; height:36px; animation:spin 0.75s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }

    /* ===== LEYENDA =====
       Ship 25.3: bottom:56px (antes 24px) — dejamos ~20px de aire bajo la
       leyenda para que la barra de escala Leaflet (pill con su propio shadow
       en bottom:12px) no quede pegada. Antes la leyenda estaba a 24px del
       borde y la escala a 12px; con la escala ahora como pill de ~24px alto,
       los dos bloques quedaban a 0px de distancia visual. */
    #legend { position:absolute; bottom:56px; left:12px; background:rgba(255,255,255,0.95); backdrop-filter:blur(4px); border-radius:12px; box-shadow:0 4px 16px rgba(0,0,0,0.1); padding:12px 14px; z-index:400; border:1px solid #e2e8f0; min-width:130px; }
    #legend h4 { font-size:12px; font-weight:700; color:#374151; margin-bottom:8px; text-align:center; letter-spacing:0.05em; }
    .legend-item { display:flex; align-items:center; gap:8px; font-size:12px; color:#4b5563; margin-bottom:4px; }
    .legend-dot { width:13px; height:13px; border-radius:50%; flex-shrink:0; }

    /* ===== INFO CARD MAPA ===== */
    #map-info {
      position:absolute; top:12px; left:12px; z-index:400;
      background:rgba(30,41,59,0.85); backdrop-filter:blur(6px);
      border-radius:12px; padding:12px 32px 12px 16px; max-width:210px;
      border:1px solid rgba(255,255,255,0.12);
      box-shadow:0 4px 16px rgba(0,0,0,0.25);
    }
    #map-info .info-title { color:#fff; font-weight:700; font-size:14px; margin-bottom:5px; }
    #map-info .info-desc { color:rgba(255,255,255,0.72); font-size:11px; line-height:1.5; }
    /* Boton cerrar — 24x24 con area efectiva de 32x32 via padding; alineado al
       angulo superior-derecho sin desplazar el contenido existente. */
    #map-info .map-info-close {
      position:absolute; top:4px; right:4px;
      width:24px; height:24px;
      background:transparent; border:0; padding:0;
      color:rgba(255,255,255,0.55); font-size:18px; line-height:1;
      cursor:pointer; border-radius:6px;
      display:flex; align-items:center; justify-content:center;
      transition:background 0.15s, color 0.15s;
    }
    #map-info .map-info-close:hover,
    #map-info .map-info-close:focus-visible {
      background:rgba(255,255,255,0.12); color:#fff; outline:none;
    }

    /* ===== LEAFLET LAYER CONTROL ===== */
    .leaflet-control-layers { border-radius:10px !important; border:none !important; box-shadow:0 4px 16px rgba(0,0,0,0.15) !important; overflow:hidden; }
    .leaflet-control-layers-expanded { padding:8px 12px !important; background:rgba(255,255,255,0.95) !important; backdrop-filter:blur(4px); }
    .leaflet-control-layers-base label { font-size:12px !important; font-weight:600 !important; color:#374151 !important; }
    .leaflet-control-zoom { border:none !important; box-shadow:0 4px 16px rgba(0,0,0,0.15) !important; }

    /* ===== MODO OSCURO ===== */
    body.dark { background:#0f172a; color:#f1f5f9; }
    body.dark #app-header { background:linear-gradient(135deg,#052e16 0%,#14532d 50%,#166534 100%); }
    body.dark #sidebar { background:#1e293b; border-right-color:#334155; }
    body.dark #sidebar-filters { background:#1e293b; border-bottom-color:#334155; }
    body.dark #stats-bar { background:#0f2d1a; border-bottom-color:#166534; }
    body.dark .form-select, body.dark .form-input { background:#0f172a; border-color:#475569; color:#f1f5f9; }
    body.dark .form-label { color:#94a3b8; }
    body.dark .station-card { border-bottom-color:#334155; }
    body.dark .station-card:hover { background:#334155; }
    body.dark .station-card.active { background:#14532d; }
    body.dark .card-title { color:#f1f5f9; }
    body.dark .card-sub, body.dark .card-time { color:#94a3b8; }
    body.dark #legend { background:rgba(15,23,42,0.95); border-color:#334155; }
    body.dark #legend h4, body.dark .legend-item { color:#e2e8f0; }
    body.dark #map-info { background:rgba(2,6,23,0.9); }
    body.dark .leaflet-control-layers-expanded { background:rgba(15,23,42,0.95) !important; }
    body.dark .leaflet-control-layers-base label { color:#e2e8f0 !important; }
    body.dark .leaflet-popup-content-wrapper { background:#1e293b !important; }
    body.dark .leaflet-popup-content { color:#f1f5f9; }
    body.dark .fuel-row { border-bottom-color:#334155; }
    body.dark .fuel-row span { color:#94a3b8 !important; }
    body.dark .empty-state p { color:#94a3b8; }
    body.dark .btn-icon { color:#4ade80; }
    body.dark .stat-chip { background:#14532d; color:#86efac; border-color:#166534; }
    #btn-dark { background:none; border:none; cursor:pointer; padding:4px 8px; color:#fff; font-size:15px; flex-shrink:0; border-radius:6px; transition:background 0.15s; }
    #btn-dark:hover { background:rgba(255,255,255,0.15); }

    /* Geocoder del header retirado: los estilos se limpiaron con el elemento. */

    /* ===== LEAFLET OVERRIDES — popups estilo Google Maps InfoWindow ===== */
    .leaflet-popup-content-wrapper {
      border-radius: 8px !important;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15), 0 4px 24px rgba(0,0,0,0.15) !important;
      padding: 0 !important;
      overflow: hidden;
      border: none !important;
      background: #fff !important;
    }
    .leaflet-popup-content { min-width:260px; max-width:300px; font-size:13px; margin:14px 16px !important; line-height:1.4; }
    .leaflet-popup-tip-container { display:none; }
    .leaflet-popup-close-button {
      color: #fff !important; font-size: 20px !important;
      top: 10px !important; right: 12px !important;
      opacity: 0.80; z-index: 10;
      width: 22px !important; height: 22px !important;
      line-height: 20px !important; text-align: center;
      border-radius: 50%; background: rgba(0,0,0,0.25);
      font-weight: 400 !important; padding: 0 !important;
    }
    .leaflet-popup-close-button:hover { opacity: 1; background: rgba(0,0,0,0.40); }
    .fuel-row { display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px solid #f3f4f6; }
    .fuel-row:last-child { border-bottom:none; }

    /* Zoom control — estilo Google Maps: botones mas grandes (40px), sombra
       mas pronunciada, margen desde el borde, y simbolos +/- mas legibles. */
    .leaflet-control-zoom { margin: 0 10px 24px 0 !important; }
    .leaflet-control-zoom a {
      font-size: 22px !important; font-weight: 400 !important;
      width: 40px !important; height: 40px !important; line-height: 40px !important;
      color: #5f6368 !important; background: #fff !important;
    }
    .leaflet-control-zoom a:hover { background: #f1f3f4 !important; color: #202124 !important; }
    .leaflet-bar { border-radius: 8px !important; border: none !important; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.08) !important; }
    .leaflet-bar a { border-bottom-color: #e8eaed !important; }
    .leaflet-bar a:last-child { border-bottom: none !important; }
    body.dark .leaflet-control-zoom a { background: #202124 !important; color: #e8eaed !important; }
    body.dark .leaflet-control-zoom a:hover { background: #303134 !important; color: #fff !important; }
    body.dark .leaflet-bar a { border-bottom-color: #3c4043 !important; }

    /* Scale — pill blanco con shadow matching la leyenda/stats-nacional para
       que la esquina inferior izquierda se sienta cohesiva. Ship 25.3: antes el
       scale aparecia como una barrita Google-style con border solo top/bottom
       que chocaba visualmente con la leyenda (panel redondeado con shadow)
       justo encima — se veia desconectado. Ahora los 2 son pills del mismo
       estilo separados por 8px. */
    .leaflet-control-scale { margin: 0 0 12px 12px !important; }
    .leaflet-control-scale-line {
      border: 1px solid #e2e8f0 !important;
      border-radius: 10px !important;
      background: rgba(255,255,255,0.95) !important;
      backdrop-filter: blur(4px);
      color: #4b5563 !important;
      font-size: 11px !important;
      padding: 4px 10px !important;
      font-weight: 600;
      font-family: inherit;
      box-shadow: 0 4px 16px rgba(0,0,0,0.10);
      letter-spacing: 0.02em;
    }
    body.dark .leaflet-control-scale-line {
      background: rgba(15,23,42,0.95) !important;
      border-color: #334155 !important;
      color: #e2e8f0 !important;
    }

    /* Control de capas — pill flotante blanco tipo Google "chip selector". */
    .leaflet-control-layers { margin: 10px 10px 0 0 !important; }
    .leaflet-control-layers-expanded {
      padding: 10px 14px !important; background: #fff !important;
      border-radius: 8px !important; backdrop-filter: none !important;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.08) !important;
    }
    .leaflet-control-layers-base label { font-size: 13px !important; font-weight: 500 !important; color: #3c4043 !important; padding: 2px 0; cursor: pointer; }
    .leaflet-control-layers-base label:hover { color: #1967d2 !important; }
    body.dark .leaflet-control-layers-expanded { background: #202124 !important; }
    body.dark .leaflet-control-layers-base label { color: #e8eaed !important; }
    body.dark .leaflet-control-layers-base label:hover { color: #8ab4f8 !important; }

    /* ===== SCROLLBAR ===== */
    ::-webkit-scrollbar { width:5px; }
    ::-webkit-scrollbar-track { background:#f1f5f9; }
    ::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:3px; }
    ::-webkit-scrollbar-thumb:hover { background:#94a3b8; }

    /* ===== SIDEBAR TOGGLE ===== */
    #btn-toggle-sidebar { display:block; cursor:pointer; background:none; border:none; padding:6px; border-radius:6px; transition:background 0.15s; margin-right:4px; }
    #btn-toggle-sidebar:hover { background:rgba(255,255,255,0.15); }
    #sidebar { transition: width 0.28s ease, min-width 0.28s ease; }

    /* ===== BACKDROP MOBILE ===== */
    /* z-index alto para cubrir controles Leaflet (z-index:1000 por defecto)
       cuando el sidebar esta abierto en overlay. El sidebar queda encima
       (z-index 1100 en la media query), el backdrop justo debajo. */
    #sidebar-backdrop {
      display:none; position:fixed; inset:0; z-index:1050;
      background:rgba(0,0,0,0.45); backdrop-filter:blur(2px);
    }
    #sidebar-backdrop.show { display:block; }

    /* ===== HEADER ELEMENTS ===== */
    .header-logo { font-size:22px; margin-right:8px; flex-shrink:0; }
    .header-title { color:#fff; font-weight:700; font-size:15px; line-height:1.2; }
    .header-sub { color:rgba(255,255,255,0.7); font-size:11px; line-height:1.2; }
    .header-badge { background:rgba(255,255,255,0.2); color:#fff; font-size:12px; font-weight:600; border-radius:9999px; padding:3px 12px; white-space:nowrap; }
    .header-update { color:rgba(255,255,255,0.65); font-size:11px; white-space:nowrap; }

    /* ===== ROW LAYOUTS ===== */
    .row { display:flex; gap:8px; align-items:flex-end; }
    .row .flex-1 { flex:1; min-width:0; }

    /* ===================================================
       RESPONSIVE
       ================================================= */

    /* ---- Sidebar overlay: todo < 1024px ---- */
    @media (max-width: 1023px) {
      #sidebar {
        position: fixed !important;
        top: 60px; left: 0;
        height: calc(100% - 60px);
        width: min(340px, 92vw) !important;
        min-width: 0 !important;
        /* z-index 1100: por encima de controles Leaflet (1000) y del header (1000)
           para el area de overlap. El hamburger sigue en el header y permanece
           accesible porque el sidebar empieza en top:60px (no tapa el header). */
        z-index: 1100;
        transform: translateX(-110%);
        transition: transform 0.28s ease !important;
        box-shadow: none;
        /* Scroll unico en movil: filtros + favs + stats + lista fluyen en
           una misma columna scroleable. El usuario hace scroll hacia abajo y
           ve todo (filtros arriba, lista de gasolineras debajo) — mismo
           comportamiento visual que en escritorio pero adaptado al viewport
           vertical del movil. */
        overflow-y: auto !important;
        overflow-x: hidden !important;
        -webkit-overflow-scrolling: touch;
      }
      #sidebar.open {
        transform: translateX(0) !important;
        box-shadow: 4px 0 24px rgba(0,0,0,0.22);
      }
      /* El mapa ocupa todo el ancho */
      #app-body { flex-direction: column; }
      #map-container { flex: 1; }

      /* En movil, filtros y lista no scrollean por separado — lo hace el
         sidebar entero. Quitamos overflow/flex internos para que se
         comporten como bloques estaticos uno encima del otro. */
      #sidebar-filters {
        flex: 0 0 auto !important;
        max-height: none !important;
        overflow: visible !important;
      }
      #station-list {
        flex: 0 0 auto !important;
        min-height: 0 !important;
        overflow: visible !important;
      }

      /* Geolocate mas visible en movil: mini-boton con fondo, ya no se
         confunde con un icono. Tap target >= 40x40 (recomendacion Apple HIG). */
      #btn-geolocate {
        background: #dcfce7;
        border: 1px solid #86efac;
        border-radius: 10px;
        min-width: 40px; min-height: 40px;
        padding: 8px 10px; font-size: 16px;
        display: inline-flex; align-items: center; justify-content: center;
      }
      #btn-geolocate:hover, #btn-geolocate:active { background: #bbf7d0; color: #14532d; }
      body.dark #btn-geolocate { background: #14532d; border-color: #166534; color: #86efac; }
      body.dark #btn-geolocate:hover, body.dark #btn-geolocate:active { background: #166534; }

      /* NOTA: NO tocar el hamburger (#btn-toggle-sidebar) aqui. Crecerlo a
         40x40 comprime el resto del header (titulo + geocoder) en iPhone
         y "Gasolineras España" se rompe en dos lineas. Queda con su
         padding:6px original — es un icono de 16px, con target ~28x28,
         suficiente ya que esta pegado al borde izquierdo (zona de Fitts
         amplia) y es el unico elemento clickable en esa esquina. */
    }

    /* ---- Sidebar inline: desktop >= 1024px ---- */
    @media (min-width: 1024px) {
      #sidebar {
        width: 320px; min-width: 320px;
        position: relative;
        transform: none !important;
        transition: width 0.28s ease, min-width 0.28s ease !important;
        overflow: hidden;
      }
      /* Colapso a tira de 48px: contenido desaparece, botón sigue en header */
      #sidebar.collapsed {
        width: 48px !important;
        min-width: 48px !important;
      }
      #sidebar.collapsed #sidebar-filters,
      #sidebar.collapsed #station-list,
      #sidebar.collapsed #stats-bar {
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s;
      }
      #sidebar-filters,
      #station-list,
      #stats-bar {
        opacity: 1;
        transition: opacity 0.2s 0.1s;
      }
      #sidebar-backdrop { display: none !important; }
    }

    /* ---- Header compacto < 640px ---- */
    @media (max-width: 639px) {
      #app-header { height: 50px; padding: 0 10px; }
      body        { padding-top: 50px; }
      #app-body   { height: calc(100vh - 50px); }
      #sidebar    { top: 50px !important; height: calc(100% - 50px) !important; }
      .header-logo  { font-size: 18px; margin-right: 5px; }
      .header-title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .header-sub   { display: none; }
      #lbl-count, #lbl-update { display: none !important; }
    }

    /* ---- Muy compacto < 380px (iPhone SE, mini) ---- */
    @media (max-width: 379px) {
      .header-title { font-size: 12px; }
      .header-logo-img { width: 28px !important; height: 28px !important; }
    }

    /* ---- Header medio 640-1023px ---- */
    @media (min-width: 640px) and (max-width: 1023px) {
      .header-sub { display: none; }
    }

    /* ---- Overlays del mapa < 768px ---- */
    @media (max-width: 767px) {
      #map-info { display: none; }
      #legend { bottom: 48px; left: 8px; padding: 8px 10px; min-width: 110px; }
      #legend h4 { font-size: 11px; margin-bottom: 5px; }
      .legend-item { font-size: 11px; margin-bottom: 3px; }
      .legend-dot  { width: 10px; height: 10px; }
      /* Install button: el CSS inline lo pone en bottom-right pero en mobile
         el zoom +/- de Leaflet vive ahi. Lo subimos lo suficiente para no
         tapar los controles de zoom (~80px de alto con margen). */
      #btn-install-pwa {
        bottom: 80px !important;
        right: 8px !important;
        font-size: 11px !important;
        padding: 7px 12px !important;
      }
      /* Ship 25.3: Media nacional tambien se reposiciona en mobile. El header
         aqui es 50px (no 60px), asi que pegamos el widget justo debajo con
         10px de aire. Tambien apretamos el padding y max-width para que no
         tape medio mapa en mobiles estrechos. */
      #stats-nacional {
        top: 60px !important;
        right: 8px !important;
        max-width: 180px !important;
        padding: 6px 10px !important;
        font-size: 11px !important;
      }
    }

    /* ---- Formularios tactiles < 640px ---- */
    /* Mas aire entre campos — el sidebar en overlay debe respirar. Apple HIG
       recomienda >= 44px de altura para controles; aumentamos padding en
       selects/inputs/botones para que todos cumplan. */
    @media (max-width: 639px) {
      #sidebar-filters { padding: 14px 14px 18px; }
      .form-group { margin-bottom: 14px; }
      .form-label { font-size: 12px; margin-bottom: 6px; }
      .form-select, .form-input { font-size: 16px; padding: 11px 12px; }
      .input-icon-wrap .form-input { padding-left: 34px; }
      .btn-primary { padding: 11px 16px; font-size: 14px; min-height: 44px; }
      .btn-ghost { padding: 10px 14px; font-size: 13px; min-height: 42px; }
      .station-card { padding: 14px 12px; }
      .card-title { font-size: 14px; }
      /* Separador visual entre titulo "Busqueda + geolocate" y los filtros */
      #sidebar-filters > div:first-child {
        padding-bottom: 10px;
        margin-bottom: 14px !important;
        border-bottom: 1px solid #e2e8f0;
      }
      body.dark #sidebar-filters > div:first-child { border-bottom-color: #334155; }
      /* El slider de deposito no se puede quedar pegado al boton */
      #in-tank, #in-radius { height: 6px; }
      .range-group { gap: 12px; padding: 4px 0; }
    }

    /* =============================================================
       ===== MEJORAS PROFESIONALES =================================
       ============================================================= */

    /* ---- Utilidades de accesibilidad ---- */
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    :focus-visible { outline: 2px solid #16a34a !important; outline-offset: 2px !important; border-radius: 4px; }
    body.dark :focus-visible { outline-color: #4ade80 !important; }

    /* ---- Tarjetas: extras ---- */
    .station-card { position: relative; }
    .medal { display:inline-block; font-size:14px; margin-right:4px; vertical-align:middle; }
    .savings-badge {
      display:inline-block; background:#dcfce7; color:#15803d;
      border:1px solid #bbf7d0; border-radius:6px; padding:1px 7px;
      font-size:10px; font-weight:700; margin-top:3px; white-space:nowrap;
    }
    body.dark .savings-badge { background:#14532d; color:#86efac; border-color:#166534; }
    /* Variante para cuando el ahorro neto es negativo (el desvio cuesta mas
       que el ahorro bruto). Ambar: el usuario lo ve pero no lo confunde con
       "comprar aqui" verde. */
    .savings-badge--negative { background:#fffbeb; color:#d97706; border-color:#fcd34d; }
    body.dark .savings-badge--negative { background:#422006; color:#fcd34d; border-color:#a16207; }
    .savings-sub { font-weight:500; opacity:0.85; }

    /* ---- Chip de anomalia (cardHTML) ---- */
    /* Marca estaciones cuyo precio cae en el 10% mas caro del listado actual
       filtrado. Paleta ambar diferenciada de savings-badge (verde ahorro) y
       de savings-badge--negative (ambar mas tenue de "desvio no compensa")
       — aqui es un rojo-ambar mas saturado para que llame la atencion sin
       gritarle al usuario. */
    .anomaly-chip {
      display:inline-block; border-radius:6px; padding:1px 7px;
      font-size:10px; font-weight:700; margin-top:3px; white-space:nowrap;
      border:1px solid transparent;
    }
    .anomaly-chip--expensive {
      background:#fef2f2; color:#b91c1c; border-color:#fecaca;
    }
    body.dark .anomaly-chip--expensive {
      background:#450a0a; color:#fca5a5; border-color:#7f1d1d;
    }

    /* ---- Predictor semanal badge (popup) ----
       Placeholder + variantes good/neutral/bad. La logica vive en
       classifyPriceVsCycle; aqui solo pintamos segun el verdict. ---- */
    .predict-slot { min-height: 0; margin: 6px 0 0; }
    .predict-slot:empty { display: none; }
    .predict-badge {
      display:inline-block; padding:3px 9px; border-radius:8px;
      font-size:11px; font-weight:700; letter-spacing:0.02em;
      border:1px solid transparent; white-space:nowrap;
    }
    .predict-badge--good    { background:#dcfce7; color:#15803d; border-color:#bbf7d0; }
    .predict-badge--neutral { background:#fef3c7; color:#a16207; border-color:#fde68a; }
    .predict-badge--bad     { background:#fee2e2; color:#b91c1c; border-color:#fca5a5; }
    body.dark .predict-badge--good    { background:#14532d; color:#86efac; border-color:#166534; }
    body.dark .predict-badge--neutral { background:#451a03; color:#fcd34d; border-color:#a16207; }
    body.dark .predict-badge--bad     { background:#450a0a; color:#fca5a5; border-color:#991b1b; }

    /* ---- Modal ruta A->B ----
       Reutiliza estilos de .modal/.modal-body pero anade layout especifico
       para los sugerencias del geocoder y la tabla de resultados. ---- */
    .route-sug {
      display:none; margin-top:4px; border:1px solid #e2e8f0; border-radius:8px;
      background:#fff; max-height:200px; overflow-y:auto; font-size:12px;
    }
    .route-sug.show { display:block; }
    .route-sug-item {
      padding:6px 10px; cursor:pointer; border-bottom:1px solid #f1f5f9;
      color:#334155;
    }
    .route-sug-item:hover, .route-sug-item.active { background:#f0fdf4; color:#15803d; }
    .route-sug-item:last-child { border-bottom:0; }
    body.dark .route-sug { background:#1e293b; border-color:#334155; }
    body.dark .route-sug-item { color:#cbd5e1; border-bottom-color:#334155; }
    body.dark .route-sug-item:hover, body.dark .route-sug-item.active { background:#14532d; color:#86efac; }

    .route-status { font-size:12px; color:#64748b; margin:8px 0; min-height:16px; }
    .route-status.error { color:#dc2626; }
    body.dark .route-status { color:#94a3b8; }
    body.dark .route-status.error { color:#fca5a5; }

    .route-results { display:flex; flex-direction:column; gap:8px; }
    .route-card {
      padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0;
      border-radius:10px; display:flex; justify-content:space-between; gap:10px;
      cursor:pointer; transition:background 0.1s, border-color 0.1s;
    }
    .route-card:hover { background:#f0fdf4; border-color:#86efac; }
    .route-card-info { flex:1; min-width:0; }
    .route-card-title { font-size:13px; font-weight:700; color:#0f172a; margin-bottom:3px; }
    .route-card-sub { font-size:11px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .route-card-right { text-align:right; }
    .route-card-price { font-size:14px; font-weight:800; color:#16a34a; }
    .route-card-off { font-size:11px; color:#64748b; margin-top:2px; }
    body.dark .route-card { background:#0f172a; border-color:#334155; }
    body.dark .route-card:hover { background:#14532d; border-color:#166534; }
    body.dark .route-card-title { color:#f1f5f9; }
    body.dark .route-card-sub, body.dark .route-card-off { color:#94a3b8; }

    /* ---- Plan de paradas (fuel stops) ----
       Bloque destacado con las paradas RECOMENDADAS en orden. Cada parada
       lleva numeracion (#1, #2...) y la distancia desde origen. ---- */
    .route-plan { display:flex; flex-direction:column; gap:10px; margin:8px 0 16px 0; }
    .route-plan-title {
      font-size:12px; font-weight:700; color:#0f172a; text-transform:uppercase;
      letter-spacing:0.5px; margin-bottom:4px;
    }
    .route-plan-subtitle {
      font-size:12px; color:#16a34a; font-weight:600; margin-bottom:6px;
    }
    .route-plan-stop {
      padding:12px 14px; background:#ecfdf5; border:2px solid #86efac;
      border-radius:12px; display:flex; justify-content:space-between; gap:10px;
      align-items:center;
    }
    .route-plan-badge {
      display:inline-block; min-width:28px; height:28px; line-height:28px;
      text-align:center; background:#16a34a; color:#fff; border-radius:50%;
      font-weight:800; font-size:13px; margin-right:10px;
    }
    .route-plan-info { flex:1; min-width:0; display:flex; align-items:center; }
    .route-plan-main { flex:1; min-width:0; }
    .route-plan-title2 { font-size:14px; font-weight:700; color:#0f172a; margin-bottom:3px; }
    .route-plan-sub { font-size:11px; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .route-plan-right { text-align:right; flex-shrink:0; }
    .route-plan-price { font-size:16px; font-weight:800; color:#16a34a; }
    .route-plan-km { font-size:11px; color:#475569; margin-top:2px; font-weight:600; }
    .route-plan-warning {
      padding:10px 12px; background:#fef2f2; border:1px solid #fca5a5;
      border-radius:10px; color:#991b1b; font-size:13px;
    }
    .route-plan-success {
      padding:10px 12px; background:#f0fdf4; border:1px solid #86efac;
      border-radius:10px; color:#166534; font-size:13px; font-weight:600;
    }
    body.dark .route-plan-title { color:#f1f5f9; }
    body.dark .route-plan-subtitle { color:#86efac; }
    body.dark .route-plan-stop { background:#14532d; border-color:#166534; }
    body.dark .route-plan-badge { background:#22c55e; color:#052e16; }
    body.dark .route-plan-title2 { color:#f1f5f9; }
    body.dark .route-plan-sub, body.dark .route-plan-km { color:#cbd5e1; }
    body.dark .route-plan-price { color:#86efac; }
    body.dark .route-plan-warning { background:#450a0a; border-color:#991b1b; color:#fca5a5; }
    body.dark .route-plan-success { background:#14532d; border-color:#166534; color:#86efac; }

    /* ---- Modo ruta: overlay flotante sobre el mapa ---- */
    /* Cuando el usuario planifica una ruta, entramos en "modo ruta":
       ocultamos el cluster de estaciones, dibujamos la polilinea + marcadores
       grandes de las paradas recomendadas, y mostramos este banner flotante
       para salir. */
    .route-mode-bar {
      position: fixed; z-index: 1200;
      /* top:72px = 60px del header + 12px de margen. Antes estaba en 12px
         y quedaba VISUALMENTE detras del header (aunque por z-index estaba
         delante): el usuario no lo encontraba. */
      top: 72px; left: 50%; transform: translateX(-50%);
      display: none; align-items: center; gap: 10px;
      padding: 8px 12px 8px 14px; border-radius: 999px;
      background: rgba(15, 118, 110, 0.96); color: #ecfeff;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
      font-size: 13px; font-weight: 600;
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,0.15);
    }
    .route-mode-bar.show { display: inline-flex; }
    .route-mode-bar-text { white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
    .route-mode-bar-exit {
      cursor: pointer; background: #0f766e; color: #ecfeff;
      border: 1px solid rgba(255,255,255,0.25); border-radius: 999px;
      padding: 4px 12px; font-size: 12px; font-weight: 700;
      transition: background .15s ease;
    }
    .route-mode-bar-exit:hover { background: #134e4a; }
    body.dark .route-mode-bar { background: rgba(6, 95, 70, 0.95); }

    /* Toggle "Ver todas en ruta" dentro del banner flotante. Mismo lenguaje
       visual que el boton de salida, pero en tono claro (outline) cuando
       esta off y tono solido cuando esta on (aria-pressed). Asi el usuario
       ve de un vistazo si el mapa esta en "solo paradas" vs "todas". */
    .route-mode-bar-corridor {
      cursor: pointer; background: transparent; color: #ecfeff;
      border: 1px solid rgba(255,255,255,0.45); border-radius: 999px;
      padding: 4px 10px; font-size: 12px; font-weight: 700;
      transition: background .15s ease, color .15s ease;
      white-space: nowrap;
    }
    .route-mode-bar-corridor:hover { background: rgba(255,255,255,0.1); }
    .route-mode-bar-corridor[aria-pressed="true"] {
      background: #ecfeff; color: #0f766e; border-color: #ecfeff;
    }
    .route-mode-bar-corridor[aria-pressed="true"]:hover { background: #cffafe; }

    /* Bloque de deep-links a apps de navegacion, en el banner flotante.
       Se oculta si no hay origen/destino confirmado. Colores de marca para
       que sean inmediatamente reconocibles sobre el banner teal. */
    .route-mode-bar-nav { display: inline-flex; gap: 6px; align-items: center; }
    .route-mode-bar-nav::before {
      content: 'Abrir ruta:';
      font-size: 11px; font-weight: 600; opacity: .85;
      margin-right: 2px;
    }
    .route-mode-bar-nav a {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 5px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 800;
      text-decoration: none; color: white;
      border: 1px solid rgba(255,255,255,0.25);
      transition: filter .15s ease, transform .1s ease;
      white-space: nowrap;
    }
    .route-mode-bar-nav a#nav-gmaps { background: #4285F4; }
    .route-mode-bar-nav a#nav-amaps { background: #111827; }
    .route-mode-bar-nav a#nav-waze  { background: #33ccff; color: #0b1220; }
    .route-mode-bar-nav a:hover { filter: brightness(1.08); }
    .route-mode-bar-nav a:active { transform: scale(.96); }

    @media (max-width: 640px) {
      .route-mode-bar {
        font-size: 12px; padding: 6px 10px; gap: 6px;
        flex-wrap: wrap; max-width: calc(100vw - 16px);
      }
      .route-mode-bar-text { max-width: 100%; flex: 1 0 100%; text-align: center; }
      .route-mode-bar-nav { flex-wrap: wrap; justify-content: center; width: 100%; }
      .route-mode-bar-nav a { padding: 4px 8px; font-size: 11px; }
      .route-mode-bar-nav::before { display: none; }
      .route-mode-bar-corridor { padding: 4px 8px; font-size: 11px; }
    }

    /* Ship 7: paradas intermedias en el planificador de ruta. Cada row se
       pinta como input con un boton "x" para eliminar. Max 3 paradas
       (limite de Google Maps URL encoding ~9 total, Apple tiene practico
       de 2-3 antes de degradar). El boton "Anadir parada" va debajo del
       stack y queda ghost. */
    .route-stops-wrap:empty { display: none; }
    .route-stops-wrap { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .route-stop-row {
      display: flex; gap: 6px; align-items: stretch; position: relative;
    }
    .route-stop-row .form-input { flex: 1; }
    .route-stop-row .btn-route-stop-remove {
      flex: 0 0 auto; width: 38px;
      background: transparent; border: 1px solid #e2e8f0; color: #94a3b8;
      border-radius: 8px; font-size: 14px; cursor: pointer;
      transition: background .15s ease, color .15s ease, border-color .15s ease;
    }
    .route-stop-row .btn-route-stop-remove:hover {
      background: #fee2e2; border-color: #fecaca; color: #dc2626;
    }
    body.dark .route-stop-row .btn-route-stop-remove { border-color: #475569; color: #64748b; }
    body.dark .route-stop-row .btn-route-stop-remove:hover { background: #451a03; border-color: #78350f; color: #f87171; }
    .btn-route-add-stop {
      margin-bottom: 14px; align-self: flex-start;
      background: transparent; color: #16a34a; border: 1px dashed #86efac;
      padding: 6px 12px; border-radius: 8px; font-size: 13px; cursor: pointer;
      transition: background .15s ease, color .15s ease;
    }
    .btn-route-add-stop:hover { background: #ecfdf5; color: #047857; }
    .btn-route-add-stop[disabled] {
      opacity: 0.5; cursor: not-allowed; pointer-events: none;
    }
    body.dark .btn-route-add-stop { color: #4ade80; border-color: #14532d; }
    body.dark .btn-route-add-stop:hover { background: #064e3b; color: #6ee7b7; }
    /* sugerencias de los inputs de paradas — reuso de .route-sug */
    .route-stop-row .route-sug {
      position: absolute; top: 100%; left: 0; right: 44px; z-index: 20;
    }

    /* ===== Ship 8: REPORTE DE PRECIO INCORRECTO ===== */
    /* Link discreto que aparece debajo del precio en el popup. Se ve como un
       texto pequeno subrayado punteado — no compite con los CTAs principales
       (guardar / compartir / comparar) ni el boton de navegacion. */
    .popup-report-link {
      display: inline-block; margin-top: 6px; padding: 2px 0;
      background: none; border: none; cursor: pointer;
      font-size: 11px; color: #94a3b8; text-decoration: underline dotted;
      text-underline-offset: 2px; text-decoration-color: #cbd5e1;
    }
    .popup-report-link:hover { color: #dc2626; text-decoration-color: #fca5a5; }
    body.dark .popup-report-link { color: #64748b; text-decoration-color: #475569; }
    body.dark .popup-report-link:hover { color: #f87171; text-decoration-color: #7f1d1d; }

    /* Caja contextual arriba del modal: "Estas reportando ESSO Madrid (Diesel
       — oficial 1,499 EUR/L)". Fondo gris claro, borde izquierdo rojo suave
       para senalar que estamos en una accion "sensible". */
    .report-context {
      background: #fef2f2; border-left: 3px solid #fca5a5; border-radius: 0 8px 8px 0;
      padding: 8px 10px; margin-bottom: 12px; font-size: 12px; color: #475569;
      line-height: 1.4;
    }
    .report-context strong { color: #1e293b; }
    body.dark .report-context { background: #1f1212; border-left-color: #7f1d1d; color: #cbd5e1; }
    body.dark .report-context strong { color: #f1f5f9; }

    /* ===== Ship 10: HISTOGRAMA PERCENTIL EN POPUP ===== */
    /* Mini-grafico horizontal en 5 bins quintil (verde->rojo). Un marcador
       vertical senala la posicion de la estacion. Se integra en el popup
       entre el precio y las badges de ahorro — da contexto inmediato sin
       abrir otra vista. */
    .popup-percentile           { margin: 6px 0 2px; display: flex; flex-direction: column; gap: 4px; }
    .popup-percentile .ph-track { position: relative; height: 10px; border-radius: 5px; overflow: visible; }
    .popup-percentile .ph-bins  { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px; border-radius: 5px; overflow: hidden; }
    .popup-percentile .ph-bin   { height: 100%; }
    .popup-percentile .ph-bin--q0 { background: #16a34a; }
    .popup-percentile .ph-bin--q1 { background: #84cc16; }
    .popup-percentile .ph-bin--q2 { background: #facc15; }
    .popup-percentile .ph-bin--q3 { background: #f97316; }
    .popup-percentile .ph-bin--q4 { background: #dc2626; }
    body.dark .popup-percentile .ph-bin--q0 { background: #15803d; }
    body.dark .popup-percentile .ph-bin--q1 { background: #4d7c0f; }
    body.dark .popup-percentile .ph-bin--q2 { background: #ca8a04; }
    body.dark .popup-percentile .ph-bin--q3 { background: #c2410c; }
    body.dark .popup-percentile .ph-bin--q4 { background: #b91c1c; }
    /* Marcador: linea vertical estrecha con un "diente" superior — salta
       por encima del track con triangulo apuntando abajo. Color adaptado. */
    .popup-percentile .ph-marker {
      position: absolute; top: -4px; bottom: -4px; width: 3px;
      background: #111827; border-radius: 2px;
      transform: translateX(-50%);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.9);
    }
    body.dark .popup-percentile .ph-marker {
      background: #f1f5f9; box-shadow: 0 0 0 2px rgba(15,23,42,0.9);
    }
    .popup-percentile .ph-label { font-size: 10px; line-height: 1.25; color: #475569; font-weight: 500; }
    body.dark .popup-percentile .ph-label { color: #cbd5e1; }
    .popup-percentile .ph-label--q0 { color: #166534; font-weight: 700; }
    .popup-percentile .ph-label--q4 { color: #991b1b; }
    body.dark .popup-percentile .ph-label--q0 { color: #86efac; }
    body.dark .popup-percentile .ph-label--q4 { color: #fca5a5; }

    /* Ship 6: boton flotante de heatmap. Mismo lenguaje visual que los
       controles de Leaflet (cuadro blanco, borde sutil) para que se integre.
       Se posiciona debajo del zoom (arriba-izquierda) en desktop; abajo-
       derecha en mobile. aria-pressed=true pinta el boton en rojo solido. */
    .map-floating-btn {
      position: absolute; top: 90px; left: 10px; z-index: 800;
      width: 34px; height: 34px; border-radius: 6px;
      background: #fff; color: #334155;
      border: 2px solid rgba(0,0,0,0.2);
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      cursor: pointer; font-size: 15px;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background .15s ease, color .15s ease, transform .1s ease;
    }
    .map-floating-btn:hover { background: #f8fafc; color: #16a34a; }
    .map-floating-btn:active { transform: scale(.94); }
    .map-floating-btn[aria-pressed="true"] {
      background: #dc2626; color: #fff; border-color: #b91c1c;
    }
    body.dark .map-floating-btn { background: #1e293b; color: #cbd5e1; border-color: #475569; }
    body.dark .map-floating-btn:hover { background: #334155; color: #fb923c; }
    body.dark .map-floating-btn[aria-pressed="true"] {
      background: #dc2626; color: #fff; border-color: #991b1b;
    }

    /* Ship 25.5: segundo boton flotante (#btn-chargers) apilado debajo del de
       heatmap. 34px alto + 8px gap = offset de 42px respecto a top:90px → 132px.
       Color "activo" azul eléctrico (#2563eb) para diferenciar semanticamente
       del rojo del heatmap (precios) — cuando ambos estan pulsados el usuario
       ve dos estados distintos sin tener que leer el icono. */
    .map-floating-btn--chargers {
      top: 132px;
    }
    .map-floating-btn--chargers:hover { color: #2563eb; }
    .map-floating-btn--chargers[aria-pressed="true"] {
      background: #2563eb; color: #fff; border-color: #1d4ed8;
    }
    body.dark .map-floating-btn--chargers:hover { color: #60a5fa; }
    body.dark .map-floating-btn--chargers[aria-pressed="true"] {
      background: #2563eb; color: #fff; border-color: #1e40af;
    }

    /* Ship 25.5: pin de punto de recarga electrica. Circulo azul con icono de
       rayo blanco. Tamaño compacto (26px) para que no compita visualmente con
       los pins-precio de gasolineras — mismas convenciones de sombra/borde. */
    .charger-pin {
      width: 26px; height: 26px; border-radius: 50%;
      background: #2563eb; color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700;
      border: 2px solid #fff;
      box-shadow: 0 2px 6px rgba(37,99,235,0.45), 0 0 0 1px rgba(0,0,0,0.08);
    }
    /* Fast DC (>=50kW) en verde azulado mas llamativo para señalar potencia. */
    .charger-pin--fast {
      background: #0891b2;
      box-shadow: 0 2px 6px rgba(8,145,178,0.5), 0 0 0 1px rgba(0,0,0,0.08);
    }
    /* Ultra (>=150kW) en violeta — mismo lenguaje que Tesla/CCS ultra. */
    .charger-pin--ultra {
      background: #7c3aed;
      box-shadow: 0 2px 6px rgba(124,58,237,0.5), 0 0 0 1px rgba(0,0,0,0.08);
    }
    body.dark .charger-pin { border-color: #0f172a; }

    /* Cluster de recargadores: similar al de gasolineras pero en azul, sin
       badge de precio (los puntos de recarga rara vez publican tarifa). */
    .charger-cluster {
      background: rgba(37,99,235,0.85); color: #fff;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 12px;
      border: 3px solid rgba(255,255,255,0.9);
      box-shadow: 0 4px 12px rgba(37,99,235,0.35);
    }
    body.dark .charger-cluster { border-color: rgba(15,23,42,0.9); }

    /* Popup de recargador. Heredamos tipografia del popup de gasolineras pero
       con cabecera en azul. Mantener compacto: titulo + operador + lista de
       conectores con potencia. */
    .charger-popup { min-width: 200px; font-size: 13px; line-height: 1.45; }
    .charger-popup-title { font-weight: 700; font-size: 14px; color: #1e293b; margin-bottom: 4px; }
    .charger-popup-op { color: #64748b; font-size: 12px; margin-bottom: 8px; }
    .charger-popup-row {
      display: flex; justify-content: space-between; gap: 10px;
      padding: 4px 0; border-top: 1px solid #e2e8f0;
    }
    .charger-popup-row:first-of-type { border-top: none; }
    .charger-popup-label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
    .charger-popup-value { color: #0f172a; font-weight: 600; }
    .charger-popup-kw { color: #2563eb; font-weight: 700; }
    .charger-popup-kw--fast { color: #0891b2; }
    .charger-popup-kw--ultra { color: #7c3aed; }
    body.dark .charger-popup-title { color: #f1f5f9; }
    body.dark .charger-popup-op { color: #94a3b8; }
    body.dark .charger-popup-row { border-top-color: #334155; }
    body.dark .charger-popup-label { color: #94a3b8; }
    body.dark .charger-popup-value { color: #e2e8f0; }
    body.dark .charger-popup-kw { color: #60a5fa; }
    body.dark .charger-popup-kw--fast { color: #22d3ee; }
    body.dark .charger-popup-kw--ultra { color: #a78bfa; }

    /* Botonera "Abrir ruta en..." dentro del panel del plan. */
    .route-nav-title {
      margin-top: 14px; margin-bottom: 6px;
      font-size: 12px; font-weight: 700; color: #334155;
      text-transform: uppercase; letter-spacing: .04em;
    }
    body.dark .route-nav-title { color: #cbd5e1; }
    .route-nav-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
    .route-nav-btn {
      flex: 1 1 110px;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 10px 12px; border-radius: 8px;
      font-size: 13px; font-weight: 700;
      text-decoration: none; color: white;
      transition: opacity .15s ease, transform .1s ease;
    }
    .route-nav-btn:hover { opacity: 0.92; }
    .route-nav-btn:active { transform: scale(.98); }
    .route-nav-google { background: #4285F4; }
    .route-nav-apple  { background: #111827; }
    .route-nav-waze   { background: #33ccff; color: #0b1220; }
    .route-nav-note {
      font-size: 11px; color: #64748b; margin-top: 6px; line-height: 1.4;
    }
    body.dark .route-nav-note { color: #94a3b8; }
    /* Marcador grande de parada: numero + icono de gasolinera.
       Se superpone al mapa, con el numero de orden de la parada. */
    .route-stop-marker {
      display: flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border-radius: 50%;
      background: #16a34a; color: white;
      font-weight: 800; font-size: 15px;
      border: 3px solid white;
      box-shadow: 0 3px 10px rgba(0,0,0,0.3);
    }
    body.dark .route-stop-marker { border-color: #0f172a; }

    .form-help { font-size:11px; color:#64748b; margin-top:4px; }
    body.dark .form-help { color:#94a3b8; }

    /* ---- Autonomia EDITABLE en el modal de perfil ----
       Input numerico grande + unidad pequena. Visualmente destaca porque es
       el dato clave que el planificador de rutas usa. Al ser editable, el
       usuario puede ajustar la autonomia real de su coche y el JS re-deriva
       el consumo para mantener la ecuacion coherente. */
    .profile-autonomy {
      display: inline-flex; align-items: baseline; gap: 6px;
      padding: 6px 14px; border-radius: 10px;
      background: linear-gradient(135deg, #ecfdf5, #d1fae5);
      border: 1px solid #bbf7d0;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .profile-autonomy:focus-within {
      border-color: #10b981;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
    }
    .profile-autonomy-input {
      /* Hereda el look del numero grande pero sigue siendo un <input>. */
      font-size: 28px; font-weight: 800; color: #065f46; letter-spacing: -0.02em;
      background: transparent; border: none; outline: none; padding: 0;
      width: 4ch; text-align: right; font-family: inherit;
      -moz-appearance: textfield;
    }
    .profile-autonomy-input::-webkit-outer-spin-button,
    .profile-autonomy-input::-webkit-inner-spin-button {
      -webkit-appearance: none; margin: 0;
    }
    .profile-autonomy-unit { font-size: 13px; font-weight: 700; color: #047857; text-transform: uppercase; letter-spacing: 0.04em; }
    /* Lapiz a la derecha para dejar claro que el numero se puede editar.
       Sin el icono, el input numerico grande parece un valor estatico —
       el lapiz + cursor texto del input son la senal de "editame". */
    .profile-autonomy-pencil {
      font-size: 14px; opacity: 0.7; margin-left: 4px;
      transition: opacity 0.15s, transform 0.15s;
    }
    .profile-autonomy:hover .profile-autonomy-pencil,
    .profile-autonomy:focus-within .profile-autonomy-pencil {
      opacity: 1; transform: scale(1.15);
    }
    body.dark .profile-autonomy {
      background: linear-gradient(135deg, #064e3b, #065f46);
      border-color: #166534;
    }
    body.dark .profile-autonomy:focus-within {
      border-color: #10b981;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.35);
    }
    body.dark .profile-autonomy-input { color: #6ee7b7; }
    body.dark .profile-autonomy-unit { color: #a7f3d0; }

    /* Ship 25.4: variante readonly — mismo estilo visual que el input editable,
       pero sin borde focus ni hover-pencil (no se puede editar; es un display).
       El numero se actualiza en vivo desde JS. */
    .profile-autonomy--readonly { cursor: default; }
    .profile-autonomy--readonly:focus-within { box-shadow: none; border-color: #34d399; }
    .profile-autonomy-value {
      font-size: 28px; font-weight: 800; color: #065f46; letter-spacing: -0.02em;
      line-height: 1; min-width: 3ch; text-align: right; font-variant-numeric: tabular-nums;
    }
    body.dark .profile-autonomy-value { color: #6ee7b7; }
    .profile-autonomy-hint {
      display: block; margin-top: 6px; font-size: 11px; color: #64748b;
      font-weight: 400;
    }
    .profile-autonomy-hint code {
      background: #f1f5f9; padding: 1px 6px; border-radius: 4px;
      font-size: 11px; color: #0f172a; font-family: ui-monospace, SFMono-Regular, monospace;
    }
    body.dark .profile-autonomy-hint { color: #94a3b8; }
    body.dark .profile-autonomy-hint code { background: #1e293b; color: #e2e8f0; }

    /* ---- Bloque "Tu coche (segun perfil)" en modal ruta ----
       Resumen read-only de tank + consumo + autonomia derivada. La fila
       de autonomia se resalta porque es la que mas le importa al usuario
       para interpretar el plan. */
    .route-profile-info {
      display: flex; flex-direction: column; gap: 4px;
      padding: 10px 12px; border-radius: 10px;
      background: #f8fafc; border: 1px solid #e2e8f0;
    }
    .route-profile-row {
      display: flex; justify-content: space-between; align-items: baseline;
      font-size: 13px;
    }
    .route-profile-k { color: #475569; }
    .route-profile-v { font-weight: 700; color: #0f172a; }
    .route-profile-hl {
      margin-top: 4px; padding-top: 6px; border-top: 1px dashed #cbd5e1;
    }
    .route-profile-hl .route-profile-k { color: #047857; font-weight: 600; }
    .route-profile-hl .route-profile-v { color: #047857; font-size: 15px; }
    body.dark .route-profile-info { background: #0f172a; border-color: #334155; }
    body.dark .route-profile-k { color: #94a3b8; }
    body.dark .route-profile-v { color: #f1f5f9; }
    body.dark .route-profile-hl { border-top-color: #475569; }
    body.dark .route-profile-hl .route-profile-k { color: #6ee7b7; }
    body.dark .route-profile-hl .route-profile-v { color: #6ee7b7; }
    .route-profile-missing {
      padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5;
      background: #fef3c7; border: 1px solid #fcd34d; color: #78350f;
    }
    .route-profile-missing a { color: #92400e; font-weight: 700; text-decoration: underline; }
    body.dark .route-profile-missing { background: #422006; border-color: #78350f; color: #fde68a; }
    body.dark .route-profile-missing a { color: #fcd34d; }

    /* ---- Modal diario de repostajes ---- */
    .diary-modal { max-width: 560px; }
    .diary-stats {
      display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:14px;
    }
    .diary-stat {
      padding:8px 10px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px;
      text-align:center;
    }
    .ds-label { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:2px; }
    .ds-value { font-size:15px; font-weight:800; color:#15803d; }
    body.dark .diary-stat { background:#14532d; border-color:#166534; }
    body.dark .ds-label { color:#94a3b8; }
    body.dark .ds-value { color:#86efac; }

    .diary-subtitle { font-size:12px; color:#334155; margin:10px 0 6px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; }
    body.dark .diary-subtitle { color:#cbd5e1; }
    .diary-form-row { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:8px; }
    .diary-form { padding:10px 0; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0; margin:10px 0; }
    body.dark .diary-form { border-color:#334155; }
    .diary-list-wrap { margin-top:10px; }
    .diary-list { display:flex; flex-direction:column; gap:6px; max-height:220px; overflow-y:auto; }
    .diary-item {
      padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;
      display:flex; justify-content:space-between; align-items:center; gap:8px;
      font-size:12px;
    }
    body.dark .diary-item { background:#0f172a; border-color:#334155; color:#e2e8f0; }
    .diary-item-main { flex:1; min-width:0; }
    .diary-item-date { font-weight:700; color:#0f172a; }
    .diary-item-sub { font-size:10px; color:#64748b; margin-top:2px; }
    body.dark .diary-item-date { color:#f1f5f9; }
    body.dark .diary-item-sub { color:#94a3b8; }
    .diary-item-del {
      background:none; border:none; color:#dc2626; cursor:pointer; padding:4px 8px;
      border-radius:6px; font-size:13px;
    }
    .diary-item-del:hover { background:#fef2f2; }
    body.dark .diary-item-del:hover { background:#450a0a; }
    .diary-footer { gap:6px; flex-wrap:wrap; }
    @media (max-width: 480px) {
      .diary-stats { grid-template-columns:repeat(2, 1fr); }
      .diary-form-row { grid-template-columns:1fr; }
    }
    .distance-chip {
      display:inline-block; background:#eff6ff; color:#2563eb;
      border:1px solid #bfdbfe; border-radius:6px; padding:1px 7px;
      font-size:10px; font-weight:600; margin-left:4px; white-space:nowrap;
    }
    body.dark .distance-chip { background:#1e3a8a; color:#93c5fd; border-color:#1d4ed8; }
    .fav-btn {
      position:absolute; top:8px; right:8px;
      background:none; border:none; cursor:pointer; font-size:16px;
      color:#cbd5e1; padding:4px; border-radius:6px; transition:color 0.15s, transform 0.1s;
      z-index: 2;
    }
    .fav-btn:hover { color:#f59e0b; transform:scale(1.1); }
    .fav-btn.active { color:#f59e0b; }
    body.dark .fav-btn { color:#475569; }
    body.dark .fav-btn.active { color:#fbbf24; }
    /* Ship 20: boton 📈 de historial, alineado con el precio en la derecha
       de la card. Tamano discreto, no compite con el precio ni con el favorito.
       Usa font-size reducido y padding compacto; hover escala sutil como el fav. */
    .card-hist-btn {
      background:none; border:1px solid #e5e7eb; border-radius:6px;
      padding:2px 6px; margin-top:4px; cursor:pointer; font-size:13px;
      color:#64748b; line-height:1; transition:background 0.15s, transform 0.1s, border-color 0.15s;
    }
    .card-hist-btn:hover { background:#f1f5f9; border-color:#cbd5e1; transform:scale(1.05); }
    body.dark .card-hist-btn { border-color:#334155; color:#94a3b8; }
    body.dark .card-hist-btn:hover { background:#1e293b; border-color:#475569; }
    .status-chip {
      display:inline-block; padding:1px 7px; border-radius:10px;
      font-size:10px; font-weight:700; margin-left:4px; vertical-align:middle;
    }
    .status-open   { background:#dcfce7; color:#15803d; }
    .status-closed { background:#fef2f2; color:#dc2626; }
    body.dark .status-open { background:#14532d; color:#86efac; }
    body.dark .status-closed { background:#450a0a; color:#fca5a5; }
    /* Ship 25.6: badge "solo socios" — Costco y similares. Amarillo ambar
       para llamar la atencion sin ser alarmante (no es un error, es una
       restriccion de acceso). */
    .status-members { background:#fef3c7; color:#92400e; }
    body.dark .status-members { background:#78350f; color:#fde68a; }

    /* ---- Skeleton loader para la lista ---- */
    .skeleton-card {
      padding:10px 12px; border-bottom:1px solid #f1f5f9;
      display:flex; justify-content:space-between; align-items:center; gap:8px;
    }
    .skeleton-card .sk-left  { flex:1; min-width:0; display:flex; flex-direction:column; gap:6px; }
    .skeleton-card .sk-line  { height:10px; border-radius:4px;
      background: linear-gradient(90deg,#e2e8f0 0%,#f1f5f9 50%,#e2e8f0 100%);
      background-size:200% 100%; animation: sk-shimmer 1.3s linear infinite;
    }
    .skeleton-card .sk-title { width:70%; height:13px; }
    .skeleton-card .sk-sub   { width:85%; }
    .skeleton-card .sk-time  { width:40%; height:8px; }
    .skeleton-card .sk-badge { width:60px; height:20px; border-radius:10px;
      background: linear-gradient(90deg,#e2e8f0 0%,#f1f5f9 50%,#e2e8f0 100%);
      background-size:200% 100%; animation: sk-shimmer 1.3s linear infinite;
    }
    body.dark .skeleton-card { border-bottom-color:#334155; }
    body.dark .skeleton-card .sk-line,
    body.dark .skeleton-card .sk-badge {
      background: linear-gradient(90deg,#334155 0%,#475569 50%,#334155 100%);
      background-size:200% 100%;
    }
    @keyframes sk-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* ---- Offline banner ---- */
    #offline-banner {
      display:none; position:fixed; top:60px; left:0; right:0; z-index:900;
      background:linear-gradient(90deg,#f59e0b 0%,#d97706 100%); color:#fff;
      padding:6px 12px; font-size:12px; font-weight:600;
      text-align:center; box-shadow:0 2px 8px rgba(0,0,0,0.12);
    }
    #offline-banner.show { display:block; }
    @media (max-width: 639px) { #offline-banner { top:50px; } }

    /* ---- Stale banner (datos > 24h) ---- */
    /* Amarillo mas claro que el offline-banner para diferenciarlos: un usuario
       puede estar online y con datos viejos simultaneamente. z-index 901 para
       que se apile encima del offline-banner si ambos estan activos. */
    #stale-banner {
      display:none; position:fixed; top:60px; left:0; right:0; z-index:901;
      background:linear-gradient(90deg,#fbbf24 0%,#f59e0b 100%); color:#422006;
      padding:6px 12px; font-size:12px; font-weight:600;
      text-align:center; box-shadow:0 2px 8px rgba(0,0,0,0.12);
    }
    #stale-banner.show { display:block; }
    #stale-banner a {
      color:#7c2d12; text-decoration:underline;
      margin-left:6px; font-weight:700;
    }
    @media (max-width: 639px) { #stale-banner { top:50px; } }
    @media (prefers-reduced-motion: no-preference) {
      #stale-banner.show { animation: stale-pulse 3s ease-in-out infinite; }
      @keyframes stale-pulse {
        0%,100% { filter:brightness(1); }
        50%     { filter:brightness(1.08); }
      }
    }

    /* ---- Tendencia nacional (hoy vs snapshot anterior) ----
       Strip horizontal, no-intrusivo. Colores del delta:
        - verde / flecha abajo si bajan los precios (bueno para el usuario)
        - rojo / flecha arriba si suben
        - gris / igual si la diferencia es <0.5 c/L (ruido). ---- */
    #trend-strip {
      background: #f1f5f9;
      color: #334155;
      padding: 6px 14px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #e2e8f0;
      position: relative;
    }
    #trend-strip[hidden] { display: none; }
    .trend-strip-label { font-weight: 600; color: #64748b; }
    .trend-strip-item { font-weight: 500; }
    .trend-strip-item .dlt { font-weight: 700; margin-left: 4px; }
    .trend-strip-item .dlt-down { color: #15803d; }
    .trend-strip-item .dlt-up   { color: #b91c1c; }
    .trend-strip-item .dlt-flat { color: #64748b; }
    .trend-strip-sep { color: #cbd5e1; }
    .trend-strip-close {
      margin-left: auto;
      background: none;
      border: 0;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      color: #94a3b8;
      padding: 0 4px;
    }
    .trend-strip-close:hover { color: #334155; }
    body.dark #trend-strip { background: #0f172a; color: #cbd5e1; border-bottom-color: #334155; }
    body.dark .trend-strip-label { color: #94a3b8; }
    body.dark .trend-strip-item .dlt-down { color: #4ade80; }
    body.dark .trend-strip-item .dlt-up   { color: #fca5a5; }
    body.dark .trend-strip-close:hover { color: #e2e8f0; }

    /* ---- Sliders de ahorro / radio ---- */
    .range-group { display:flex; align-items:center; gap:8px; }
    .range-group input[type=range] {
      flex:1; height:4px; accent-color:#16a34a; cursor:pointer;
    }
    .range-group .range-val {
      font-size:12px; font-weight:700; color:#15803d; min-width:50px; text-align:right;
      font-variant-numeric: tabular-nums;
    }
    body.dark .range-group .range-val { color:#4ade80; }

    /* ---- Sparkline ---- */
    .sparkline { display:block; width:100%; height:60px; margin-top:6px; }
    .sparkline path { fill:none; stroke-width:1.5; }
    .sparkline .sp-up   { stroke:#dc2626; }
    .sparkline .sp-down { stroke:#16a34a; }
    .sparkline .sp-flat { stroke:#64748b; }
    .sparkline .sp-area { fill:currentColor; opacity:0.08; }
    /* Linea de referencia (mediana provincial) — discontinua, gris apagado
       para que no compita visualmente con el trazo principal. */
    .sparkline .sp-median { stroke:#94a3b8; stroke-width:1; stroke-dasharray:3,3; fill:none; }
    .trend-label { font-size:11px; color:#64748b; }
    .trend-up   { color:#dc2626; }
    .trend-down { color:#16a34a; }

    /* ---- Panel de historico (popup) ---- */
    /* Estados del panel (loading/error/empty) y controles de rango dias. */
    .hist-panel { margin-top: 8px; }
    .hist-toggles { display:flex; gap:4px; margin-top:4px; }
    .hist-toggle {
      flex:1; padding:4px 0; font-size:11px; font-weight:600;
      border:1px solid #cbd5e1; border-radius:6px; background:#fff;
      color:#334155; cursor:pointer; transition:background 0.15s;
    }
    .hist-toggle:hover { background:#f1f5f9; }
    .hist-toggle.active { background:#16a34a; border-color:#15803d; color:#fff; }
    body.dark .hist-toggle { background:#1e293b; border-color:#334155; color:#cbd5e1; }
    body.dark .hist-toggle:hover { background:#334155; }
    body.dark .hist-toggle.active { background:#16a34a; color:#fff; }
    .hist-stats {
      display:grid; grid-template-columns: repeat(3, 1fr); gap:6px;
      margin-top:6px; font-size:11px;
    }
    .hist-stat {
      background:#f8fafc; border-radius:6px; padding:4px 6px; text-align:center;
    }
    body.dark .hist-stat { background:#0f172a; }
    .hist-stat-label { color:#64748b; font-size:10px; text-transform:uppercase; letter-spacing:0.04em; }
    .hist-stat-value { color:#0f172a; font-weight:700; font-variant-numeric:tabular-nums; }
    body.dark .hist-stat-value { color:#e2e8f0; }
    .hist-legend { display:flex; gap:10px; font-size:10px; color:#64748b; margin-top:4px; }
    .hist-legend-swatch { display:inline-block; width:14px; height:2px; margin-right:4px; vertical-align:middle; }
    .hist-legend-swatch.hist-legend-price  { background:#16a34a; }
    .hist-legend-swatch.hist-legend-median { background:#94a3b8; border-top:1px dashed #94a3b8; }
    .hist-loading, .hist-empty, .hist-error {
      padding:10px; text-align:center; font-size:11px; color:#64748b;
    }
    .hist-error { color:#b91c1c; }
    /* Badge "precio historicamente bajo" — se anade si el precio actual esta en
       el percentil <=10% del periodo consultado. Mismo tratamiento visual que
       .savings-badge para consistencia. */
    .hist-lowbadge {
      display:inline-block; margin-top:6px; padding:3px 8px; border-radius:12px;
      background:#dcfce7; color:#166534; font-size:11px; font-weight:700;
    }
    body.dark .hist-lowbadge { background:#14532d; color:#bbf7d0; }
    /* Contra-badge: precio actual en el percentil >=90% del periodo consultado.
       Mismo formato que lowbadge pero en rojo-ambar para comunicar "espera". */
    .hist-highbadge {
      display:inline-block; margin-top:6px; padding:3px 8px; border-radius:12px;
      background:#fef2f2; color:#b91c1c; font-size:11px; font-weight:700;
    }
    body.dark .hist-highbadge { background:#450a0a; color:#fca5a5; }

    /* ---- Modal (onboarding / favoritos) ---- */
    .modal-backdrop {
      position:fixed; inset:0; z-index:2000;
      background:rgba(15,23,42,0.6); backdrop-filter:blur(4px);
      display:none; align-items:center; justify-content:center; padding:16px;
    }
    .modal-backdrop.show { display:flex; }
    .modal {
      background:#fff; border-radius:16px; max-width:480px; width:100%;
      max-height:90vh; overflow-y:auto;
      box-shadow:0 20px 60px rgba(0,0,0,0.35);
    }
    body.dark .modal { background:#1e293b; color:#f1f5f9; }
    .modal-header { padding:16px 20px 8px; }
    .modal-header h2 { font-size:18px; font-weight:700; color:#14532d; margin-bottom:4px; }
    body.dark .modal-header h2 { color:#86efac; }
    .modal-header p { font-size:12px; color:#64748b; }
    body.dark .modal-header p { color:#94a3b8; }
    .modal-body { padding:8px 20px 16px; }
    .modal-footer { padding:12px 20px 16px; display:flex; justify-content:flex-end; gap:8px; border-top:1px solid #e2e8f0; }
    body.dark .modal-footer { border-top-color:#334155; }

    /* ===== Ship 22: BOTTOM SHEET EN MOVIL ===== */
    /* Breakpoint 640px (iPhone SE y superiores en portrait). En mobile el
       modal centrado se siente flotante y pequeno; el patron nativo es una
       "hoja inferior" pegada a la base con handle arriba, bordes redondeados
       superiores y animacion de slide-up.
       Aplicamos a TODOS los modales (.modal-backdrop) sin necesidad de
       tocar el DOM: solo CSS con pseudo-elemento para el handle.
       Reduce motion respetado — sin animacion de entrada. */
    @media (max-width: 639px) {
      .modal-backdrop {
        align-items: flex-end;
        padding: 0;
      }
      .modal {
        max-width: 100%;
        width: 100%;
        max-height: 88vh;
        border-radius: 20px 20px 0 0;
        position: relative;
        animation: sheet-slide-up 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
        padding-top: 18px; /* hueco para el handle */
        box-shadow: 0 -8px 32px rgba(0,0,0,0.25);
      }
      .modal::before {
        content: '';
        position: absolute;
        top: 8px; left: 50%;
        transform: translateX(-50%);
        width: 42px; height: 4px;
        background: #cbd5e1; border-radius: 2px;
      }
      body.dark .modal::before { background: #475569; }
      .modal-header { padding-top: 8px; }
      /* El cierre con la X sigue en su sitio; ampliamos area de toque en
         movil para cumplir el minimo de 44px de Apple HIG. */
      .modal-close-x {
        min-width: 36px; min-height: 36px;
        display: flex; align-items: center; justify-content: center;
      }
      /* En sobre-override para modales que definen max-width mayor
         (comparador/favoritos/diario) — en movil todos son full-width. */
      #modal-compare .modal, #modal-favs .modal, #modal-diary .modal,
      #modal-history .modal, #modal-report .modal, #modal-onboarding .modal {
        max-width: 100%;
      }
    }
    @keyframes sheet-slide-up {
      from { transform: translateY(100%); }
      to   { transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .modal { animation: none !important; }
    }
    .btn-ghost {
      background:none; border:1px solid #cbd5e1; color:#64748b;
      border-radius:8px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer;
    }
    .btn-ghost:hover { background:#f8fafc; }
    body.dark .btn-ghost { border-color:#475569; color:#cbd5e1; }
    body.dark .btn-ghost:hover { background:#334155; }

    /* Chips de seleccion (onboarding) */
    .chip-group { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
    .chip {
      padding:8px 12px; border:1.5px solid #e2e8f0; border-radius:20px;
      font-size:12px; font-weight:600; cursor:pointer; background:#fff; color:#475569;
      transition:all 0.12s;
    }
    .chip:hover { border-color:#16a34a; color:#16a34a; }
    .chip.selected { background:#16a34a; color:#fff; border-color:#16a34a; }
    body.dark .chip { background:#0f172a; border-color:#334155; color:#cbd5e1; }
    body.dark .chip:hover { border-color:#4ade80; color:#4ade80; }
    body.dark .chip.selected { background:#16a34a; color:#fff; border-color:#16a34a; }

    /* ---- Widget de gasto mensual ---- */
    #monthly-widget {
      display:none; background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);
      border:1px solid #bbf7d0; border-radius:10px; padding:10px 12px;
      margin:10px 0; font-size:12px;
    }
    #monthly-widget.show { display:block; }
    #monthly-widget .mw-title { font-size:10px; text-transform:uppercase; color:#15803d; font-weight:700; letter-spacing:0.05em; margin-bottom:4px; }
    #monthly-widget .mw-cost  { font-size:18px; font-weight:800; color:#14532d; }
    #monthly-widget .mw-sub   { font-size:11px; color:#15803d; margin-top:2px; }
    body.dark #monthly-widget { background:linear-gradient(135deg,#052e16 0%,#14532d 100%); border-color:#166534; }
    body.dark #monthly-widget .mw-title, body.dark #monthly-widget .mw-sub { color:#86efac; }
    body.dark #monthly-widget .mw-cost { color:#bbf7d0; }

    /* Toggle €/centimos retirado: sus estilos se eliminaron con el boton. */

    /* ---- Popup: botones de accion ---- */
    .popup-actions {
      display:flex; gap:6px; margin-top:8px; padding-top:8px; border-top:1px solid #f1f5f9;
    }
    .popup-actions button {
      flex:1; border:1px solid #e2e8f0; background:#fff; border-radius:6px;
      padding:5px 8px; font-size:11px; font-weight:600; cursor:pointer; color:#475569;
      display:flex; align-items:center; justify-content:center; gap:4px;
    }
    .popup-actions button:hover { background:#f0fdf4; color:#16a34a; border-color:#16a34a; }
    body.dark .popup-actions { border-top-color:#334155; }
    body.dark .popup-actions button { background:#1e293b; border-color:#334155; color:#cbd5e1; }
    body.dark .popup-actions button:hover { background:#14532d; }

    /* ---- prefers-reduced-motion ---- */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
      .spinner { animation: none; border-top-color: #16a34a; }
      .skeleton-card .sk-line, .skeleton-card .sk-badge { animation: none; background: #e2e8f0; }
      body.dark .skeleton-card .sk-line, body.dark .skeleton-card .sk-badge { background: #334155; }
    }

    /* ---- Boton estrella de favoritas en el header ---- */
    /* Estrella con insignia numerica: la estrella se rellena cuando hay
       favoritas y la insignia muestra el total. Sin favoritas, se queda
       gris y la insignia oculta. */
    .btn-header-fav {
      position: relative;
      background: none;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
      color: #64748b;
      font-size: 14px;
      transition: all 0.15s ease;
    }
    .btn-header-fav:hover { background: #f8fafc; border-color: #94a3b8; color: #374151; }
    .btn-header-fav.has-favs { color: #f59e0b; border-color: #fde68a; background: #fffbeb; }
    .btn-header-fav.has-favs:hover { background: #fef3c7; }
    body.dark .btn-header-fav { border-color: #475569; color: #cbd5e1; }
    body.dark .btn-header-fav:hover { background: #334155; }
    body.dark .btn-header-fav.has-favs { color: #fbbf24; border-color: #78350f; background: #451a03; }
    body.dark .btn-header-fav.has-favs:hover { background: #78350f; }
    .fav-badge {
      position: absolute;
      top: -6px;
      right: -6px;
      background: #dc2626;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 10px;
      min-width: 16px;
      text-align: center;
      line-height: 14px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }

    /* ---- Modal de favoritas + alertas ---- */
    /* Reutiliza .modal / .modal-backdrop base. Layout mas ancho para que
       la lista no se estreche, y con subsecciones visualmente separadas. */
    #modal-favs .modal { max-width: 540px; }
    .modal-close-x {
      background: none;
      border: 0;
      color: #94a3b8;
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
      padding: 0 6px;
    }
    .modal-close-x:hover { color: #475569; }
    body.dark .modal-close-x { color: #64748b; }
    body.dark .modal-close-x:hover { color: #e2e8f0; }
    .favs-empty {
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 10px;
      padding: 14px 12px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
    }
    /* Ship 25: panel de alertas Telegram en el modal de favoritas (sustituye Web Push). */
    .tg-alerts-panel {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; margin-bottom: 10px;
      background: linear-gradient(135deg, #e0f2fe 0%, #eff6ff 100%);
      border: 1px solid #7dd3fc; border-radius: 10px;
    }
    .tg-alerts-panel.active {
      background: linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%);
      border-color: #bbf7d0;
    }
    .tg-alerts-icon { font-size: 22px; flex-shrink: 0; }
    .tg-alerts-info { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
    .tg-alerts-text { flex: 1; min-width: 0; }
    .tg-alerts-text strong { display: block; font-size: 13px; color: #0369a1; margin-bottom: 2px; }
    .tg-alerts-text small { display: block; font-size: 11px; color: #64748b; line-height: 1.3; }
    .tg-alerts-panel.active .tg-alerts-text strong { color: #15803d; }
    .tg-alerts-btn {
      padding: 7px 14px !important; font-size: 12px !important;
      white-space: nowrap; flex-shrink: 0;
    }
    body.dark .tg-alerts-panel {
      background: linear-gradient(135deg, #0c4a6e 0%, #082f49 100%);
      border-color: #0369a1;
    }
    body.dark .tg-alerts-panel.active {
      background: linear-gradient(135deg, #14532d 0%, #166534 100%);
      border-color: #16a34a;
    }
    body.dark .tg-alerts-text strong { color: #7dd3fc; }
    body.dark .tg-alerts-text small  { color: #94a3b8; }
    body.dark .tg-alerts-panel.active .tg-alerts-text strong { color: #86efac; }
    .favs-empty i { display: block; font-size: 22px; margin-bottom: 6px; color: #cbd5e1; }
    body.dark .favs-empty { background: #0f172a; border-color: #334155; color: #94a3b8; }
    body.dark .favs-empty i { color: #475569; }
    .fav-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      margin-bottom: 6px;
      background: #fff;
      transition: background 0.15s ease;
    }
    .fav-row:hover { background: #f8fafc; }
    body.dark .fav-row { background: #1e293b; border-color: #334155; }
    body.dark .fav-row:hover { background: #334155; }
    .fav-row-info { flex: 1; min-width: 0; cursor: pointer; }
    .fav-row-title { font-weight: 600; font-size: 13px; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    body.dark .fav-row-title { color: #f1f5f9; }
    .fav-row-sub { font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    body.dark .fav-row-sub { color: #94a3b8; }
    .fav-row-price { font-size: 12px; font-weight: 700; }
    .fav-row-remove {
      background: none;
      border: 0;
      color: #cbd5e1;
      cursor: pointer;
      padding: 4px 6px;
      font-size: 14px;
      border-radius: 6px;
    }
    .fav-row-remove:hover { color: #dc2626; background: #fee2e2; }
    body.dark .fav-row-remove { color: #64748b; }
    body.dark .fav-row-remove:hover { color: #f87171; background: #450a0a; }

    /* ---- Logo del header (imagen SVG) ---- */
    .header-logo-img { border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); flex-shrink: 0; }
    #brand { outline: none; }
    #brand:focus-visible { outline: 2px solid #86efac; outline-offset: 2px; border-radius: 6px; }

    /* ---- Etiquetas de lugar del mapa (capa propia, ver renderLabels en
       client.ts). Tiles base vienen sin nombres; estas las pintamos nosotros
       solo para Espana y en castellano.
       Filosofia del estilo: imitar el look de CartoDB Voyager. Nada de texto
       grande o vistoso — una etiqueta de mapa tiene que ser INVISIBLE cuando
       no la buscas y LEGIBLE cuando si. Por eso:
        - Fuentes pequenas (11-12px).
        - Peso medio (no bold).
        - Color gris azulado con opacidad.
        - Halo blanco sutil (text-shadow) para separar del tile sin usar fondo.
       El transform:translate(-50%,-50%) centra el texto sobre las coordenadas
       (el iconAnchor por defecto no lo hace bien con texto libre). ---- */
    .map-label {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      text-align: center;
      white-space: nowrap;
      pointer-events: none;
      transform: translate(-50%, -50%);
      width: auto !important;
      height: auto !important;
      text-shadow:
        0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff, 1px 1px 2px rgba(255,255,255,0.9);
    }
    .map-label-ccaa {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.03em;
      color: #64748b;         /* slate-500: gris azulado, como Carto */
      text-transform: none;   /* mixed-case — evita "GALICIA" a grito */
    }
    .map-label-city {
      font-size: 11px;
      font-weight: 500;
      color: #1e293b;         /* slate-800: texto principal */
    }
    /* Modo oscuro: invertir el halo (ahora negro) y aclarar el texto. */
    body.dark .map-label {
      text-shadow:
        0 0 2px #000, 0 0 2px #000, 0 0 3px #000, 1px 1px 2px rgba(0,0,0,0.9);
    }
    body.dark .map-label-ccaa { color: #94a3b8; }
    body.dark .map-label-city { color: #e2e8f0; }

    /* ---- Filtros avanzados (details/summary) ----
       Colapsado por defecto. Al abrirlo muestra los chips y el select de marca.
       El chevron del details viene por defecto del navegador; lo ocultamos y
       pintamos el nuestro para controlar el estilo. ---- */
    details.adv-filters {
      margin-top: 10px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fff;
    }
    details.adv-filters summary.adv-filters-summary {
      list-style: none;
      cursor: pointer;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
      color: #475569;
      user-select: none;
    }
    details.adv-filters summary.adv-filters-summary::-webkit-details-marker { display: none; }
    details.adv-filters summary.adv-filters-summary::after {
      content: '\\25BE';
      margin-left: auto;
      font-size: 11px;
      transition: transform 0.15s;
    }
    details.adv-filters[open] summary.adv-filters-summary::after { transform: rotate(180deg); }
    details.adv-filters summary.adv-filters-summary i { color: #16a34a; }
    .adv-filters-count {
      background: #16a34a;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 9999px;
      display: none;
    }
    .adv-filters-count.show { display: inline-block; }
    .adv-filters-body { padding: 0 12px 12px; }

    /* Chips con checkbox: el input real va oculto y pintamos el label */
    .chip-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip-check {
      display: inline-flex;
      align-items: center;
      padding: 5px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      color: #475569;
      cursor: pointer;
      user-select: none;
      background: #fff;
      transition: all 0.12s;
    }
    .chip-check input[type="checkbox"] { display: none; }
    .chip-check:hover { border-color: #16a34a; color: #16a34a; }
    .chip-check:has(input:checked) {
      background: #dcfce7;
      border-color: #16a34a;
      color: #15803d;
      font-weight: 600;
    }

    body.dark details.adv-filters { background: #1e293b; border-color: #334155; }
    body.dark details.adv-filters summary.adv-filters-summary { color: #cbd5e1; }
    body.dark .chip-check { background: #0f172a; border-color: #334155; color: #cbd5e1; }
    body.dark .chip-check:hover { border-color: #22c55e; color: #22c55e; }
    body.dark .chip-check:has(input:checked) { background: #14532d; border-color: #22c55e; color: #86efac; }

    /* ============================================================
       UTILIDADES PARA CSP SIN 'unsafe-inline' EN style-src
       ------------------------------------------------------------
       Antes usabamos style="..." inline en muchos elementos, lo que
       obligaba a mantener 'unsafe-inline' en style-src de la CSP. Con
       este bloque sustituimos cada inline por una clase equivalente —
       misma visualizacion, cero riesgo de CSS-injection amplificando
       un XSS teorico. Lo que es dinamico (color de precio, tamano del
       cluster, etc.) se aplica en JS via element.style.x = valor:
       eso NO dispara CSP porque no es un atributo HTML inline sino una
       mutacion programatica del CSSOM.
       ============================================================ */

    /* utilidades atomicas */
    .u-hide                 { display: none; }
    .u-pos-rel              { position: relative; }
    .u-mw-0                 { min-width: 0; }
    .u-mt-10                { margin-top: 10px; }
    .u-mt-6                 { margin-top: 6px; }
    .u-mt-4                 { margin-top: 4px; }
    .u-mt-3                 { margin-top: 3px; }
    .u-mt-2                 { margin-top: 2px; }
    .u-mb-0                 { margin-bottom: 0; }
    .u-mr-6                 { margin-right: 6px; }
    .u-mr-4                 { margin-right: 4px; }
    .u-ml-6                 { margin-left: 6px; }
    .u-op-80                { opacity: 0.8; }
    .u-c-white              { color: #fff; }
    .u-c-green              { color: #16a34a; }
    .u-c-slate              { color: #64748b; }
    .u-fs-16                { font-size: 16px; }

    /* compuestas (estructura) */
    .brand-link             { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; min-width: 0; flex: 1; }
    .header-actions         { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .search-heading-row     { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .search-heading         { font-size: 13px; font-weight: 600; color: #374151; display: flex; align-items: center; gap: 6px; }
    .search-actions         { display: flex; gap: 6px; }
    .tank-sub               { font-weight: 400; text-transform: none; color: #64748b; }
    .btn-profile-util       { width: 100%; margin-top: 4px; font-size: 12px; }
    .stats-flex             { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; }
    .loading-line-1         { font-size: 14px; font-weight: 600; color: #374151; }
    .loading-line-2         { font-size: 12px; color: #64748b; }
    .modal-header-row       { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .ts-widget-hidden       { position: fixed; bottom: 0; right: 0; width: 1px; height: 1px; pointer-events: none; opacity: 0; }

    /* leyenda: puntos fijos (4 colores semanticos) */
    .dot-green              { background: #16a34a; }
    .dot-orange             { background: #d97706; }
    .dot-red                { background: #dc2626; }
    .dot-gray               { background: #9ca3af; }

    /* sugerencias y autocomplete */
    .suggest-highlight      { background: #bbf7d0; color: #15803d; border-radius: 2px; }
    .suggest-row            { flex: 1; min-width: 0; }
    /* Variantes de fondo para .suggest-price — antes iba inline con bg=CLRS[color]. */
    .suggest-price--green   { background: #16a34a; }
    .suggest-price--yellow  { background: #d97706; }
    .suggest-price--red     { background: #dc2626; }
    .suggest-price--gray    { background: #64748b; }
    .geocoder-empty         { color: #9ca3af; cursor: default; font-size: 12px; }
    .geocoder-sub           { font-size: 11px; color: #9ca3af; display: block; }
    .list-sentinel          { display: none; text-align: center; padding: 10px; font-size: 12px; color: #94a3b8; }
    .fav-row-sub--small     { font-size: 10px; }

    /* popup de horarios */
    .popup-muted            { color: #94a3b8; font-size: 11px; }
    .popup-h24              { color: #16a34a; font-weight: 700; font-size: 12px; }
    .popup-segment          { font-size: 11px; padding: 2px 0; }
    .popup-segment-row      { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; font-size: 11px; border-bottom: 1px solid #f1f5f9; }
    .popup-seg-day          { color: #64748b; font-weight: 600; }
    .popup-seg-hrs          { color: #1e293b; }

    /* popup de precios */
    .popup-price-main       { font-size: 22px; font-weight: 800; }
    /* .popup-price-main-unit hereda font-weight:800 del <strong> padre — asi
       lo hacia el inline original (no habia override). Solo fijamos font-size. */
    .popup-price-main-unit  { font-size: 13px; }
    .popup-price-none       { font-size: 14px; color: #9ca3af; }
    /* Variantes por rango de precio (priceColor devuelve 'green'/'yellow'/
       'red'/'gray'). Son 4 valores discretos, asi que clases son mas simples
       que data-dyn-style + CSSOM runtime. */
    .popup-price-main--green  { color: #16a34a; }
    .popup-price-main--yellow { color: #d97706; }
    .popup-price-main--red    { color: #dc2626; }
    .popup-price-main--gray   { color: #64748b; }

    /* popup de estaciones */
    .popup-root             { font-family: system-ui, sans-serif; min-width: 250px; }
    .popup-header           { color: #fff; padding: 14px 16px; margin: -12px -14px 12px; border-radius: 8px 8px 0 0; }
    .popup-header-title     { font-weight: 800; font-size: 15px; line-height: 1.2; }
    .popup-header-sub       { font-size: 11px; opacity: 0.75; margin-top: 4px; }
    .popup-header-status    { margin-top: 6px; }
    .popup-price-row        { display: flex; justify-content: space-between; align-items: center; padding: 8px 2px 10px; }
    .popup-fuel-label       { font-size: 12px; color: #64748b; }
    .popup-trend-top        { border-top: 1px solid #f1f5f9; padding-top: 8px; margin-top: 8px; }
    .popup-trend-caption    { font-size: 11px; font-weight: 700; color: #374151; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.05em; }
    .popup-trend-caption--mb4 { margin-bottom: 4px; }
    /* Gradiente del header: mainBg en 135deg hacia #0f172a. Antes era
       inline con mainBg calculado por JS; ahora una clase por rango. */
    .popup-header--green    { background: linear-gradient(135deg, #16a34a 0%, #0f172a 100%); }
    .popup-header--yellow   { background: linear-gradient(135deg, #d97706 0%, #0f172a 100%); }
    .popup-header--red      { background: linear-gradient(135deg, #dc2626 0%, #0f172a 100%); }
    .popup-header--gray     { background: linear-gradient(135deg, #64748b 0%, #0f172a 100%); }

    /* navigation buttons (Google Maps / Waze / Apple Maps) */
    .popup-nav-row          { display: flex; gap: 5px; margin-top: 12px; }
    .popup-nav-btn          { flex: 1; text-align: center; padding: 8px 4px; border-radius: 8px; font-size: 11px; font-weight: 700; text-decoration: none; }
    .popup-nav-google       { background: #4285f4; color: #fff; }
    .popup-nav-waze         { background: #09d3f7; color: #0d1b2a; }
    .popup-nav-apple        { background: #1c1c1e; color: #fff; }

    /* cluster icon — la divIcon de Leaflet se inserta en el DOM sin hook
       post-render, por eso NO usamos data-dyn-style + CSSOM. Los valores
       dinamicos (size, bg, fs del contador) caen en sets discretos, asi
       que los expresamos como combinacion de clases modificadoras. */
    .cluster-icon           { border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 3px solid rgba(255,255,255,0.85); box-shadow: 0 3px 12px rgba(0,0,0,0.3); font-family: system-ui, sans-serif; gap: 1px; }
    .cluster-icon--s36      { width: 36px; height: 36px; }
    .cluster-icon--s44      { width: 44px; height: 44px; }
    .cluster-icon--s52      { width: 52px; height: 52px; }
    .cluster-icon--green    { background: #16a34a; }
    .cluster-icon--yellow   { background: #d97706; }
    .cluster-icon--red      { background: #dc2626; }
    .cluster-icon--gray     { background: #64748b; }
    .cluster-icon-count     { color: #fff; font-weight: 800; line-height: 1; }
    .cluster-icon-count--fs9  { font-size: 9px; }
    .cluster-icon-count--fs11 { font-size: 11px; }
    .cluster-icon-price     { color: rgba(255,255,255,0.9); font-size: 8px; font-weight: 600; line-height: 1; }

    /* list rows (station-list) */
    .row-info-flex          { display: flex; justify-content: space-between; align-items: flex-start; gap: 4px; padding-right: 22px; }
    .row-info-left          { min-width: 0; flex: 1; }
    .row-info-right         { flex-shrink: 0; text-align: right; }
    .row-fuel-label         { font-size: 10px; color: #9ca3af; margin-top: 1px; }
    .row-row-noprice        { font-size: 11px; color: #9ca3af; }
    /* Coste total del deposito: debajo del precio/L, tono slate para no competir
       con el badge principal. En dark, sube el color para legibilidad sobre bg oscuro. */
    .row-tank-cost          { font-size: 11px; color: #64748b; font-weight: 600; margin-top: 2px; white-space: nowrap; }
    body.dark .row-tank-cost{ color: #94a3b8; }

    /* Ko-fi support button — cabe discreto al pie del sidebar. Icono + texto,
       sin colores de marca (para no pelear con el verde corporativo del header). */
    .kofi-support           { display:flex; align-items:center; justify-content:center; gap:6px;
                              margin: 10px 12px 14px; padding: 8px 12px; border-radius: 10px;
                              background: #fef3c7; color: #92400e; font-size: 12px; font-weight: 600;
                              text-decoration: none; border: 1px solid #fde68a; transition: background .15s; }
    .kofi-support:hover     { background: #fde68a; text-decoration: none; }
    body.dark .kofi-support { background: #422006; color: #fcd34d; border-color: #78350f; }
    body.dark .kofi-support:hover { background: #78350f; }

    /* ===== COMPARADOR SIDE-BY-SIDE =====
       Layout de 2 columnas paralelas. En desktop van lado a lado; en movil
       colapsan a 1-col y el usuario hace scroll vertical (menos optimo
       pero evita lineas microscopicas que no se leerian).
       La celda con precio mas bajo por combustible se destaca con
       .compare-winner (tint verde + tilde). Si empatan, ambas winner. */
    #modal-compare .modal           { max-width: 720px; }
    .compare-grid                   { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 640px) {
      .compare-grid                 { grid-template-columns: 1fr; }
    }
    .compare-col                    { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; background: #f8fafc; display: flex; flex-direction: column; gap: 8px; }
    body.dark .compare-col          { background: #0f172a; border-color: #334155; }
    .compare-col h3                 { font-size: 14px; font-weight: 700; color: #14532d; line-height: 1.25; word-break: break-word; }
    body.dark .compare-col h3       { color: #86efac; }
    .compare-col .compare-dir       { font-size: 11px; color: #64748b; line-height: 1.3; }
    body.dark .compare-col .compare-dir { color: #94a3b8; }
    .compare-col .compare-muni      { font-size: 11px; color: #94a3b8; }
    body.dark .compare-col .compare-muni { color: #64748b; }
    .compare-prices                 { border-top: 1px dashed #e2e8f0; padding-top: 8px; display: flex; flex-direction: column; gap: 4px; }
    body.dark .compare-prices       { border-top-color: #334155; }
    .compare-price-row              { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 12px; padding: 4px 6px; border-radius: 6px; }
    .compare-price-row .cp-label    { color: #64748b; font-weight: 500; }
    body.dark .compare-price-row .cp-label { color: #94a3b8; }
    .compare-price-row .cp-value    { color: #1e293b; font-weight: 700; font-variant-numeric: tabular-nums; }
    body.dark .compare-price-row .cp-value { color: #f1f5f9; }
    .compare-price-row .cp-value--none { color: #94a3b8; font-weight: 500; }
    .compare-price-row.compare-winner { background: #dcfce7; }
    .compare-price-row.compare-winner .cp-label { color: #166534; font-weight: 700; }
    .compare-price-row.compare-winner .cp-value { color: #14532d; }
    .compare-price-row.compare-winner .cp-value::after { content: ' \\2713'; color: #16a34a; font-weight: 900; }
    body.dark .compare-price-row.compare-winner { background: #052e16; }
    body.dark .compare-price-row.compare-winner .cp-label { color: #86efac; }
    body.dark .compare-price-row.compare-winner .cp-value { color: #bbf7d0; }
    body.dark .compare-price-row.compare-winner .cp-value::after { color: #4ade80; }
    .compare-meta                   { font-size: 11px; color: #64748b; display: flex; flex-direction: column; gap: 3px; border-top: 1px dashed #e2e8f0; padding-top: 6px; }
    body.dark .compare-meta         { color: #94a3b8; border-top-color: #334155; }

    /* ===== Ship 9: comparador multi-combustible ===== */
    /* Summary bar: "quien gana en cuantos combustibles". Grid 2-col (1 por
       estacion) con contador big y rotulo debajo. full=3/3 → verde fuerte;
       some=1/3 → verde pastel; zero=0/3 → gris (no gana en nada). */
    .compare-summary                { grid-column: 1 / -1; background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
                                      border: 1px solid #bbf7d0; border-radius: 12px; padding: 10px 12px; margin-bottom: 4px; }
    body.dark .compare-summary      { background: linear-gradient(135deg, #052e16 0%, #064e3b 100%); border-color: #14532d; }
    .compare-sum-title              { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #166534; margin-bottom: 6px; }
    body.dark .compare-sum-title    { color: #86efac; }
    .compare-sum-grid               { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    @media (max-width: 600px) {
      .compare-sum-grid             { grid-template-columns: 1fr; }
    }
    .compare-sum-item               { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px;
                                      border-radius: 8px; background: #fff; border: 1px solid #d1fae5; }
    body.dark .compare-sum-item     { background: #0b1522; border-color: #14532d; }
    .compare-sum-count              { font-size: 16px; font-weight: 800; color: #166534; font-variant-numeric: tabular-nums; }
    body.dark .compare-sum-count    { color: #86efac; }
    .compare-sum-label              { font-size: 11px; color: #475569; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    body.dark .compare-sum-label    { color: #cbd5e1; }
    .compare-sum-item.compare-sum-full .compare-sum-count  { color: #16a34a; }
    .compare-sum-item.compare-sum-some .compare-sum-count  { color: #65a30d; }
    .compare-sum-item.compare-sum-zero .compare-sum-count  { color: #94a3b8; }
    body.dark .compare-sum-item.compare-sum-full .compare-sum-count { color: #4ade80; }
    body.dark .compare-sum-item.compare-sum-some .compare-sum-count { color: #a3e635; }
    body.dark .compare-sum-item.compare-sum-zero .compare-sum-count { color: #64748b; }

    /* Delta porcentual al lado del precio no-ganador. En rojo claro para que
       salte pero sin gritar. En dark se recortan los tonos. */
    .compare-price-row .cp-delta    { font-size: 10px; font-weight: 600; color: #dc2626; margin-left: 6px;
                                      font-variant-numeric: tabular-nums; }
    body.dark .compare-price-row .cp-delta { color: #fca5a5; }

    /* Fila "Sin precio" — atenuada al 70% (no llama la atencion). */
    .compare-price-row--empty       { opacity: 0.65; }
    .compare-empty                  { grid-column: 1 / -1; text-align: center; padding: 24px 12px; color: #64748b; font-size: 13px; }
    body.dark .compare-empty        { color: #94a3b8; }

    /* Chip flotante abajo-dcha: aparece cuando hay 1 estacion en la seleccion
       y se oculta tras cerrar el modal o borrar seleccion. Tono ambar para
       diferenciarlo de los badges de estado normales. */
    .compare-chip                   { position: fixed; right: 16px; bottom: 16px; z-index: 1500;
                                      display: none; align-items: center; gap: 8px;
                                      padding: 8px 10px 8px 12px; border-radius: 999px;
                                      background: #fef3c7; color: #92400e;
                                      border: 1px solid #fde68a; box-shadow: 0 4px 14px rgba(0,0,0,0.18);
                                      font-size: 12px; font-weight: 700; }
    .compare-chip.show              { display: inline-flex; }
    body.dark .compare-chip         { background: #422006; color: #fcd34d; border-color: #78350f; }
    .compare-chip-x                 { border: none; background: transparent; color: inherit;
                                      font-size: 18px; line-height: 1; cursor: pointer;
                                      padding: 0 4px; font-weight: 700; }
    .compare-chip-x:hover           { opacity: 0.7; }

  </style>`
}
