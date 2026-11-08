// La cuenta es común a todo el portal; cuenta.js controla su sesión y sus estados.
export function cuentaHtml(): string {
  return `<div class="mh-account">
    <button id="btn-login" class="btn-login" type="button" aria-label="Iniciar sesión con Google" aria-haspopup="dialog" aria-controls="login-modal">
      <svg class="google-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.31 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.81-1.76-5.6-4.13H3.06v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.34 2.59c.79-2.37 3-4.13 5.6-4.13Z"/></svg>
      <span>Entrar con Google</span>
    </button>
    <div id="user-menu" class="user-menu" hidden>
      <button id="btn-user" class="user-chip" type="button" aria-expanded="false" aria-controls="user-dropdown" aria-label="Abrir mi cuenta">
        <span id="user-avatar" class="user-avatar" aria-hidden="true"></span>
        <span class="user-chip-copy"><span id="user-name" class="user-name">Mi cuenta</span><span id="user-save-status" class="user-save-status">Mi cuenta</span></span>
        <span class="user-chip-arrow" aria-hidden="true">⌄</span>
      </button>
      <div id="user-dropdown" class="user-dropdown" hidden>
        <div class="user-dropdown-head"><div id="user-dropdown-name" class="user-dropdown-name"></div><div id="user-dropdown-email" class="user-dropdown-email"></div></div>
        <a id="btn-user-favs" class="user-dropdown-item" href="/#mis-favoritos">Mis favoritos</a>
        <a class="user-dropdown-item" href="/mi-dia">Mi día</a>
        <p id="user-dropdown-sync" class="user-dropdown-sync" role="status" aria-live="polite">Sesión iniciada</p>
        <button id="cuenta-importar" class="user-dropdown-item cuenta-importar" type="button" hidden>Añadir favoritos de este navegador</button>
        <button id="btn-logout" class="user-dropdown-item" type="button">Cerrar sesión</button>
      </div>
    </div>
  </div>`
}

export function cuentaModalHtml(): string {
  return `<div id="login-modal" class="login-modal" hidden role="dialog" aria-modal="true" aria-labelledby="login-modal-title" aria-describedby="login-modal-sub">
    <div class="login-modal-backdrop" data-close="1"></div>
    <div class="login-modal-card">
      <button id="login-modal-close" class="login-modal-close" type="button" data-close="1" aria-label="Cerrar inicio de sesión">×</button>
      <h2 id="login-modal-title" class="login-modal-title">Tus favoritos, contigo</h2>
      <p id="login-modal-sub" class="login-modal-sub">Entra con Google para guardar tus favoritos en tu cuenta y encontrarlos siempre en el inicio, también en otro dispositivo.</p>
      <div id="gsi-button-container" class="login-modal-btn"></div>
      <p id="login-modal-status" class="login-modal-status" role="status" aria-live="polite"></p>
    </div>
  </div>`
}

export const CUENTA_CSS = `
.masthead .mh-account{position:relative;flex:none;min-width:0}
.masthead .btn-login,.masthead .user-chip{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:44px;padding:10px 14px;border:1px solid var(--mh-rule);border-radius:14px;background:var(--eu-surface);color:var(--mh-ink);font:650 13px/1.25 var(--eu-font);cursor:pointer;white-space:nowrap}
.masthead .btn-login:hover,.masthead .user-chip:hover{background:var(--mh-brand-soft);border-color:var(--mh-brand-dark)}
.masthead .google-mark{display:block;flex:none}
.masthead .user-menu{position:relative}
.masthead .user-chip{padding:6px 10px 6px 6px;max-width:220px;min-height:46px;justify-content:flex-start}
.masthead .user-avatar{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:50%;background:var(--mh-brand-soft);color:var(--mh-brand-dark);font-size:13px;font-weight:750}
.masthead .user-chip-copy{display:flex;flex-direction:column;min-width:0;text-align:left;gap:2px}
.masthead .user-name{overflow:hidden;text-overflow:ellipsis;font-weight:700;max-width:145px}
.masthead .user-save-status{font-size:10px;font-weight:500;color:var(--mh-muted);overflow:hidden;text-overflow:ellipsis;max-width:145px}
.masthead .user-chip-arrow{color:var(--mh-muted);flex:none}
.masthead .user-dropdown{position:absolute;top:calc(100% + 8px);right:0;width:280px;max-width:calc(100vw - 24px);border:1px solid var(--mh-rule);border-radius:16px;background:var(--eu-surface);color:var(--mh-ink);box-shadow:0 12px 35px #142a1f24;padding:8px;z-index:2500;white-space:normal}
.masthead .user-dropdown-head{padding:10px 10px 12px;border-bottom:1px solid var(--mh-rule);margin-bottom:4px}
.masthead .user-dropdown-name{font-size:14px;font-weight:750;overflow-wrap:anywhere}
.masthead .user-dropdown-email{font-size:12px;color:var(--mh-muted);overflow-wrap:anywhere;margin-top:3px}
.masthead .user-dropdown-item{display:flex;align-items:center;min-height:44px;width:100%;padding:10px;border:0;border-radius:9px;background:transparent;color:var(--mh-ink);font:600 13px/1.4 var(--eu-font);text-align:left;text-decoration:none;cursor:pointer;white-space:normal}
.masthead .user-dropdown-item:hover{background:var(--mh-brand-soft);color:var(--mh-brand-dark)}
.masthead .user-dropdown-sync{margin:5px 10px;padding-top:10px;border-top:1px solid var(--mh-rule);font-size:12px;line-height:1.5;color:var(--mh-brand-dark)}
.masthead .user-dropdown-sync.error{color:#b42318}.masthead .cuenta-importar{font-size:12px;color:var(--mh-muted)}
.login-modal[hidden]{display:none!important}.login-modal{position:fixed;inset:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px;font:14px/1.5 var(--eu-font);color:var(--eu-ink)}
.login-modal *{box-sizing:border-box}.login-modal-backdrop{position:absolute;inset:0;background:#13251bb3}
.login-modal-card{position:relative;width:100%;max-width:400px;max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain;padding:52px 24px 24px;border:1px solid var(--eu-line);border-radius:22px;background:var(--eu-surface);box-shadow:0 20px 60px #0005}
.login-modal .login-modal-close{position:absolute;top:8px;right:8px;display:grid;place-items:center;width:44px;height:44px;min-height:44px;padding:0;border:0;border-radius:12px;background:transparent;color:var(--eu-muted);font:28px/1 var(--eu-font);cursor:pointer}
.login-modal .login-modal-close:hover{background:var(--eu-soft);color:var(--eu-ink)}
.login-modal .login-modal-title{margin:0 0 10px;color:var(--eu-ink);font:750 23px/1.2 var(--eu-font);letter-spacing:-.5px}
.login-modal .login-modal-sub{margin:0 0 22px;color:var(--eu-muted);font-size:14px;line-height:1.6}
.login-modal-btn{display:flex;justify-content:center;min-height:44px;min-width:0;max-width:100%}.login-modal-btn>div{max-width:100%}
.login-modal .login-modal-status{margin:14px 0 0;color:var(--eu-muted);font-size:13px;line-height:1.5}.login-modal .login-modal-status:empty{display:none}.login-modal .login-modal-status.error{color:#b42318}
.login-modal :focus-visible{outline:3px solid #1462a1;outline-offset:3px}
body.dark .masthead .btn-login,body.dark .masthead .user-chip,body.dark .masthead .user-dropdown{background:#182a21}
body.dark .login-modal{--eu-surface:#182a21;--eu-ink:#eaf4ee;--eu-muted:#a7beb2;--eu-line:#344b3f;--eu-soft:#203c2e}
body.dark .masthead .user-dropdown-sync.error,body.dark .login-modal .login-modal-status.error{color:#ffb4ab}
@media(max-width:650px){.masthead .btn-login{font-size:12px;padding:10px 11px;gap:7px}.masthead .user-chip{max-width:174px}.masthead .user-name,.masthead .user-save-status{max-width:100px}}
@media(max-width:360px){.masthead .btn-login{padding:10px 8px;gap:6px}.masthead .user-chip{max-width:150px;gap:6px}.masthead .user-name,.masthead .user-save-status{max-width:83px}.login-modal{padding:12px}.login-modal-card{padding:52px 14px 22px;max-height:calc(100dvh - 24px)}}
`
