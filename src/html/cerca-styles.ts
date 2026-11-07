// Portada y panel personal comparten componentes; las secciones conservan sus controles.
export const CERCA_CSS = `
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;min-height:100vh;display:flex;flex-direction:column}
a{color:var(--eu-accent);text-underline-offset:4px}button,input,select{font:inherit}button,a,input{touch-action:manipulation}
.eu-main{width:100%;max-width:1240px;margin:0 auto;padding:36px 32px 64px;flex:1;overflow-wrap:anywhere}
.eu-eyebrow{font-size:12px;letter-spacing:.13em;text-transform:uppercase;font-weight:750;color:var(--eu-accent);margin:0 0 18px}
.eu-hero{display:grid;grid-template-columns:1.12fr 1fr;gap:48px;align-items:center;margin:12px 0 34px}
.eu-intro h1,.eu-day-head h1{font-size:clamp(42px,5.8vw,74px);font-weight:780;line-height:1.04;letter-spacing:-.055em;margin:0 0 22px}
.eu-intro h1 span,.eu-day-head h1 span{display:block;color:var(--eu-accent)}
.eu-intro>p:not(.eu-eyebrow){font-size:17px;line-height:1.7;color:var(--eu-muted);max-width:45ch;margin:0 0 22px}
.eu-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.eu-button{display:inline-flex;gap:8px;align-items:center;justify-content:center;min-height:46px;padding:12px 18px;border:1px solid var(--eu-accent);border-radius:13px;background:var(--eu-accent);color:#fff;font-size:14px;font-weight:700;text-decoration:none;cursor:pointer}
.eu-button.secondary{background:var(--eu-surface);color:var(--eu-ink);border-color:var(--eu-line)}
.eu-button:hover{filter:brightness(.95)}.eu-link{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:14px;min-height:44px}
.eu-icon{width:22px;height:22px;flex-shrink:0;vertical-align:middle;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.eu-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:stretch}
.eu-card{min-width:0;position:relative;display:flex;flex-direction:column;padding:26px;background:var(--eu-surface);border:1px solid var(--eu-line);border-radius:24px;box-shadow:0 3px 4px #17372b02;transition:transform .18s,box-shadow .18s}
.eu-card:hover{transform:translateY(-2px);box-shadow:0 10px 28px #17372b0a}
.eu-card-top{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:16px}
.eu-tag{display:inline-flex;align-items:center;gap:9px;font-size:13px;font-weight:700;letter-spacing:.01em}
.eu-tag .eu-icon{width:20px;height:20px}.eu-bookmark{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--eu-line);background:transparent;color:inherit;border-radius:10px;min-width:40px;min-height:40px;padding:7px;cursor:pointer}
.eu-bookmark.is-saved{background:var(--eu-soft);color:var(--eu-accent)}.eu-bookmark.is-saved .eu-icon{fill:currentColor;stroke:var(--eu-surface)}
.eu-card h2{color:inherit;font-size:23px;font-weight:730;letter-spacing:-.035em;line-height:1.2;margin:0 0 11px}.eu-card h3{color:inherit;font-size:15px;margin:14px 0 8px}
.eu-card p{margin:0 0 14px}.eu-muted{color:var(--eu-muted);font-size:14px;line-height:1.6}
.eu-card .eu-card-foot{margin-top:auto;padding-top:20px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
.eu-card-foot a{font-weight:700;font-size:14px;min-height:44px;display:inline-flex;align-items:center}
.eu-source{font-size:12px;line-height:1.5;color:var(--eu-muted);margin-top:14px!important}
.eu-weather{background:#eaf2e5;border-color:#dbe6d4;min-height:340px;overflow:hidden}
.eu-weather .eu-card-top,.eu-weather .eu-card-foot{position:relative;z-index:1}
.eu-weather h2{font-size:28px;position:relative;z-index:1}
.eu-weather-main{display:flex;justify-content:space-between;gap:12px;align-items:center;flex:1}
.eu-weather-number{font-size:clamp(48px,5.2vw,70px);font-weight:750;line-height:1;letter-spacing:-.055em}.eu-weather-range{display:block;font-size:13px;color:var(--eu-muted);margin:9px 0}
.eu-weather-symbol{font-size:80px;line-height:1.2;filter:drop-shadow(0 6px 14px #b2c7a8);padding:5px}
.eu-weather-empty{font-size:22px;max-width:15ch;font-weight:650;line-height:1.3}.eu-weather-summary{font-size:15px;font-weight:600}
.eu-weather-strip{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}.eu-weather-strip a{font-size:12px;color:var(--eu-ink);padding:7px 9px;border-radius:9px;background:#ffffff8c;text-decoration:none}
.eu-gas{background:#173d2d;color:#fff;border-color:#173d2d}.eu-gas .eu-muted,.eu-gas .eu-source{color:#c3d8cc}.eu-gas a{color:var(--eu-lime)}.eu-gas .eu-bookmark{border-color:#53735f;color:#fff}.eu-gas .eu-bookmark.is-saved{background:#34543e}.eu-gas .eu-button{background:var(--eu-lime);color:#17372b;border-color:var(--eu-lime)}
.eu-price{font-weight:740;font-size:43px;letter-spacing:-.045em;line-height:1.2;margin:8px 0 3px!important}.eu-price small{font-size:17px;letter-spacing:0;font-weight:500}.eu-price-label{font-size:12px;color:#c3d8cc;margin-bottom:6px!important}
.eu-pharmacy{background:#f4f4e9}.eu-pharmacy-symbol{display:flex;justify-content:center;align-items:center;width:56px;height:56px;border-radius:16px;background:#e2ebd8;color:#2c6b46;font-size:38px;font-weight:400;margin:6px 0 18px}
.eu-score{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 14px;align-items:center;padding:15px 0;border-top:1px solid var(--eu-line);border-bottom:1px solid var(--eu-line);font-size:14px;font-weight:650;margin-bottom:13px}
.eu-score b{font-size:26px;font-variant-numeric:tabular-nums}
.eu-direct{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.eu-direct a{display:flex;align-items:center;gap:6px;border:1px solid var(--eu-line);border-radius:10px;padding:8px 10px;text-decoration:none;font-size:13px;min-height:40px}
.eu-section-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:30px 0 18px}.eu-section-head h2{font-size:26px;letter-spacing:-.035em;margin:0}.eu-section-head p{font-size:13px;color:var(--eu-muted);margin:0}
.eu-day-head{display:flex;justify-content:space-between;align-items:center;gap:24px;margin:14px 0 24px}.eu-day-head h1{font-size:clamp(38px,4.2vw,54px);margin-bottom:12px}.eu-day-head h1 span{display:inline}.eu-day-head .eu-eyebrow{margin-bottom:12px}.eu-day-head p{color:var(--eu-muted);max-width:56ch;font-size:15px;line-height:1.6;margin:0}
[data-mi-dia]>.eu-link{min-height:32px}[data-mi-dia] .localidad{padding:14px 0}[data-mi-dia] .localidad-servicios a{padding:10px 12px}[data-mi-dia] .localidad-servicios span{display:none}
.eu-adjust{background:var(--eu-surface);border:1px solid var(--eu-line);border-radius:24px;padding:24px;margin:0 0 24px}.eu-adjust h2{font-size:23px;margin:0 0 8px}.eu-adjust>p{color:var(--eu-muted);font-size:14px;margin:8px 0 16px}
.eu-settings{list-style:none;margin:0 0 20px;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 20px}.eu-setting{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 0;border-bottom:1px solid var(--eu-line);min-width:0}.eu-setting label{display:flex;align-items:center;gap:9px;min-width:0;font-size:14px;font-weight:650}.eu-setting input{width:19px;height:19px;accent-color:var(--eu-accent);flex-shrink:0}.eu-setting-arrows{display:flex;gap:5px}.eu-setting button{min-width:40px;min-height:40px;border:1px solid var(--eu-line);border-radius:9px;background:var(--eu-soft);color:var(--eu-ink);cursor:pointer}.eu-setting button:disabled{opacity:.4;cursor:default}
.eu-empty{border:1px dashed var(--eu-line);border-radius:24px;padding:36px;text-align:center;background:var(--eu-surface);margin:24px 0}.eu-empty h2{font-size:25px}.eu-favorites,.eu-favorites ul{list-style:none;padding:0;margin:8px 0 0}.eu-favorites li{border-top:1px solid var(--eu-line);padding:8px 0;font-size:13px}.eu-gas .eu-favorites li{border-color:#53735f}.eu-favorites a{display:block;min-height:36px;padding:6px 0}.eu-favorites p{font-size:12px;line-height:1.5}.eu-support{display:flex;justify-content:space-between;gap:24px;align-items:center;background:#eaf0e6;border-radius:24px;padding:26px 30px;margin-top:26px}.eu-support h2{font-size:23px;letter-spacing:-.03em;margin:0 0 8px}.eu-support p{margin:0;color:var(--eu-muted);font-size:14px;max-width:60ch}
.eu-footer{max-width:1240px;width:100%;margin:auto;padding:26px 32px 30px;border-top:1px solid var(--eu-line);display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--eu-muted)}.eu-footer p{margin:0}.eu-footer nav{display:flex;flex-wrap:wrap;gap:12px 20px}.eu-footer a{min-height:36px;display:inline-flex;align-items:center;color:var(--eu-muted)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(min-width:900px){.eu-home-grid .eu-gas{grid-column:span 2}.eu-home-grid .eu-gas .eu-price{font-size:52px}.eu-home-grid .eu-gas .eu-card-foot{justify-content:space-between}}
@media(max-width:1000px){.eu-hero{gap:26px}.eu-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.eu-main{padding:28px 24px 46px}.eu-card{padding:22px}}
@media(max-width:650px){.eu-main{padding:24px 16px 36px}.eu-hero{grid-template-columns:1fr;gap:24px;margin-top:0}.eu-intro h1{font-size:clamp(42px,10vw,60px)}.eu-intro>p:not(.eu-eyebrow){font-size:15px}.eu-eyebrow{font-size:11px;margin-bottom:14px}.eu-grid{grid-template-columns:1fr;gap:16px}.eu-card{padding:22px;border-radius:var(--eu-radius)}.eu-weather{min-height:310px}.eu-weather-number{font-size:60px}.eu-day-head{display:block}.eu-day-head>.eu-button{margin-top:20px}.eu-section-head{align-items:flex-start;flex-direction:column;gap:8px}.eu-section-head h2{font-size:24px}.eu-settings{grid-template-columns:1fr}.eu-adjust{padding:18px}.eu-support{padding:22px;display:block}.eu-support .eu-button{margin-top:18px}.eu-footer{padding:24px 16px}.eu-weather-symbol{font-size:68px}}
@media(prefers-reduced-motion:reduce){.eu-card{transition:none}.eu-card:hover{transform:none}}
`
