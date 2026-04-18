export function getStyles(): string {
  return `<style>
    /* ===== RESET & BASE ===== */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; width: 100%; overflow: hidden; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f8fafc; }

    /* ===== LAYOUT PRINCIPAL ===== */
    #app-header {
      position: fixed; top: 0; left: 0; right: 0;
      height: 60px; z-index: 1000;
      background: linear-gradient(135deg, #14532d 0%, #166534 40%, #16a34a 100%);
      display: flex; align-items: center; padding: 0 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25);
    }
    #app-body {
      position: fixed; top: 60px; left: 0; right: 0; bottom: 0;
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
    #sidebar-filters {
      padding: 12px; background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      overflow-y: auto; flex-shrink: 0;
    }
    #stats-bar {
      padding: 8px 12px; background: #f0fdf4;
      border-bottom: 1px solid #bbf7d0;
      flex-shrink: 0; display: none;
    }
    #station-list {
      flex: 1; overflow-y: auto;
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
      background: #16a34a; color: #fff; border: none; border-radius: 8px;
      padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      transition: background 0.15s; display:inline-flex; align-items:center; gap:6px;
    }
    .btn-primary:hover { background: #15803d; }
    .btn-primary:active { background: #166534; }
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
    .empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:24px; color:#94a3b8; }
    .empty-state .icon { font-size:48px; margin-bottom:12px; }
    .empty-state p { font-size:14px; font-weight:500; color:#64748b; }
    .empty-state small { font-size:12px; margin-top:4px; }

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

    /* ===== LEYENDA ===== */
    #legend { position:absolute; bottom:24px; left:12px; background:rgba(255,255,255,0.95); backdrop-filter:blur(4px); border-radius:12px; box-shadow:0 4px 16px rgba(0,0,0,0.1); padding:12px 14px; z-index:400; border:1px solid #e2e8f0; min-width:130px; }
    #legend h4 { font-size:12px; font-weight:700; color:#374151; margin-bottom:8px; text-align:center; letter-spacing:0.05em; }
    .legend-item { display:flex; align-items:center; gap:8px; font-size:12px; color:#4b5563; margin-bottom:4px; }
    .legend-dot { width:13px; height:13px; border-radius:50%; flex-shrink:0; }

    /* ===== INFO CARD MAPA ===== */
    #map-info {
      position:absolute; top:12px; left:12px; z-index:400;
      background:rgba(30,41,59,0.85); backdrop-filter:blur(6px);
      border-radius:12px; padding:12px 16px; max-width:210px;
      border:1px solid rgba(255,255,255,0.12);
      box-shadow:0 4px 16px rgba(0,0,0,0.25);
    }
    #map-info .info-title { color:#fff; font-weight:700; font-size:14px; margin-bottom:5px; }
    #map-info .info-desc { color:rgba(255,255,255,0.72); font-size:11px; line-height:1.5; }

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

    /* ===== GEOCODER ===== */
    #geocoder-wrap { position:relative; flex-shrink:1; min-width:0; }
    #geocoder-input {
      border:none; outline:none; border-radius:8px; padding:6px 10px 6px 30px;
      font-size:12px; width:180px; max-width:40vw;
      background:rgba(255,255,255,0.18); color:#fff;
      transition:width 0.2s ease, background 0.2s;
    }
    #geocoder-input::placeholder { color:rgba(255,255,255,0.55); }
    #geocoder-input:focus { background:rgba(255,255,255,0.28); width:240px; outline:none; }
    #geocoder-icon { position:absolute; left:9px; top:50%; transform:translateY(-50%); color:rgba(255,255,255,0.65); font-size:11px; pointer-events:none; }
    #geocoder-results {
      position:absolute; top:calc(100% + 6px); left:0; min-width:260px; z-index:2000;
      background:#fff; border-radius:10px; box-shadow:0 6px 24px rgba(0,0,0,0.18);
      overflow:hidden; display:none;
    }
    #geocoder-results.show { display:block; }
    .geocoder-item { padding:9px 13px; font-size:12px; cursor:pointer; color:#374151; border-bottom:1px solid #f1f5f9; line-height:1.4; }
    .geocoder-item:hover { background:#f0fdf4; color:#15803d; }
    .geocoder-item:last-child { border-bottom:none; }
    .geocoder-item strong { display:block; font-size:13px; color:#1e293b; }
    body.dark #geocoder-results { background:#1e293b; box-shadow:0 6px 24px rgba(0,0,0,0.4); }
    body.dark .geocoder-item { color:#cbd5e1; border-bottom-color:#334155; }
    body.dark .geocoder-item:hover { background:#334155; }
    body.dark .geocoder-item strong { color:#f1f5f9; }

    /* ===== LEAFLET OVERRIDES ===== */
    .leaflet-popup-content-wrapper {
      border-radius: 12px !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18) !important;
      padding: 0 !important;
      overflow: hidden;
      border: none !important;
    }
    .leaflet-popup-content { min-width:250px; max-width:300px; font-size:13px; margin:12px 14px !important; }
    .leaflet-popup-tip-container { display:none; }
    .leaflet-popup-close-button {
      color: #fff !important; font-size: 18px !important;
      top: 8px !important; right: 10px !important;
      opacity: 0.75; z-index: 10;
    }
    .leaflet-popup-close-button:hover { opacity: 1; }
    .fuel-row { display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px solid #f3f4f6; }
    .fuel-row:last-child { border-bottom:none; }

    /* Zoom control visual */
    .leaflet-control-zoom a {
      font-size: 16px !important; font-weight: 300 !important;
      width: 34px !important; height: 34px !important; line-height: 34px !important;
    }
    .leaflet-bar { border-radius: 10px !important; border: none !important; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.15) !important; }
    .leaflet-bar a { border-bottom-color: #f1f5f9 !important; }
    .leaflet-bar a:last-child { border-bottom: none !important; }

    /* Scale */
    .leaflet-control-scale-line { border-color: #64748b !important; color: #64748b; font-size: 10px !important; background: rgba(255,255,255,0.85) !important; padding: 1px 5px !important; border-radius: 3px; }
    body.dark .leaflet-control-scale-line { background: rgba(15,23,42,0.85) !important; color: #94a3b8; border-color: #475569 !important; }

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
      #app-body   { top: 50px; }
      #sidebar    { top: 50px !important; height: calc(100% - 50px) !important; }
      .header-logo  { font-size: 18px; margin-right: 5px; }
      .header-title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .header-sub   { display: none; }
      #lbl-count, #lbl-update { display: none !important; }
      /* El geocoder se encoge para dejar espacio al titulo. Crece al hacer
         focus (ya esta en las reglas base de #geocoder-input:focus). */
      #geocoder-input { width: 110px !important; max-width: 28vw !important; font-size: 13px; padding: 6px 10px 6px 28px; }
      #geocoder-input:focus { width: 60vw !important; max-width: 60vw !important; }
      #geocoder-wrap { margin-right: 4px !important; }
    }

    /* ---- Muy compacto < 380px (iPhone SE, mini) ---- */
    @media (max-width: 379px) {
      .header-title { font-size: 12px; }
      #geocoder-input { width: 90px !important; max-width: 24vw !important; }
      .header-logo-img { width: 28px !important; height: 28px !important; }
    }

    /* ---- Header medio 640-1023px ---- */
    @media (min-width: 640px) and (max-width: 1023px) {
      .header-sub { display: none; }
    }

    /* ---- Overlays del mapa < 768px ---- */
    @media (max-width: 767px) {
      #map-info { display: none; }
      #legend { bottom: 12px; left: 8px; padding: 8px 10px; min-width: 110px; }
      #legend h4 { font-size: 11px; margin-bottom: 5px; }
      .legend-item { font-size: 11px; margin-bottom: 3px; }
      .legend-dot  { width: 10px; height: 10px; }
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
    .status-chip {
      display:inline-block; padding:1px 7px; border-radius:10px;
      font-size:10px; font-weight:700; margin-left:4px; vertical-align:middle;
    }
    .status-open   { background:#dcfce7; color:#15803d; }
    .status-closed { background:#fef2f2; color:#dc2626; }
    body.dark .status-open { background:#14532d; color:#86efac; }
    body.dark .status-closed { background:#450a0a; color:#fca5a5; }

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

    /* ---- Sliders de ahorro / radio ---- */
    .range-group { display:flex; align-items:center; gap:8px; }
    .range-group input[type=range] {
      flex:1; height:4px; accent-color:#16a34a; cursor:pointer;
    }
    .range-group .range-val {
      font-size:12px; font-weight:700; color:#16a34a; min-width:50px; text-align:right;
      font-variant-numeric: tabular-nums;
    }
    body.dark .range-group .range-val { color:#4ade80; }

    /* ---- Sparkline ---- */
    .sparkline { display:block; width:100%; height:30px; margin-top:6px; }
    .sparkline path { fill:none; stroke-width:1.5; }
    .sparkline .sp-up   { stroke:#dc2626; }
    .sparkline .sp-down { stroke:#16a34a; }
    .sparkline .sp-flat { stroke:#64748b; }
    .sparkline .sp-area { fill:currentColor; opacity:0.08; }
    .trend-label { font-size:11px; color:#64748b; }
    .trend-up   { color:#dc2626; }
    .trend-down { color:#16a34a; }

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

    /* ---- Toggle €/céntimos ---- */
    .unit-toggle {
      background: rgba(255,255,255,0.18); color:#fff;
      border: none; border-radius:6px; padding:4px 10px;
      font-size:11px; font-weight:700; cursor:pointer;
      transition:background 0.12s;
    }
    .unit-toggle:hover { background: rgba(255,255,255,0.28); }

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

    /* ---- Panel de favoritos ---- */
    #favs-section { display:none; border-bottom:1px solid #e2e8f0; background:#fffbeb; }
    #favs-section.show { display:block; }
    #favs-section h3 { padding:8px 12px 4px; font-size:11px; font-weight:700; color:#92400e; text-transform:uppercase; letter-spacing:0.05em; }
    body.dark #favs-section { background:#1c1917; border-bottom-color:#334155; }
    body.dark #favs-section h3 { color:#fbbf24; }

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

  </style>`
}
