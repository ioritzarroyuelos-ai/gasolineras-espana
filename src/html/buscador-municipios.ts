import type { ResultadoTiempo } from '../lib/tiempo-municipios'
import { escapeHtml as esc } from './html'

export const CSS_BUSCADOR_MUNICIPIOS = `
.met-buscador{margin:0;max-width:40rem}
.met-buscador label{display:block;font-weight:650;margin-bottom:.4rem}
.met-campo{position:relative;display:flex;gap:.4rem}
.met-campo input{flex:1;min-width:0;font:inherit;font-size:1rem;border:1px solid #839788;border-radius:.45rem;padding:.65rem .8rem;color:#172d21;background:#fff}
.met-campo button{border:0;border-radius:.45rem;background:#225535;color:#fff;font:inherit;font-weight:650;padding:.55rem 1rem;cursor:pointer}
.met-campo :focus-visible,.met-resultados a:focus-visible{outline:3px solid #22683e;outline-offset:2px}
.met-sugs,.met-resultados{list-style:none;margin:0;padding:0}
.met-sugs{position:absolute;z-index:5;left:0;right:0;top:calc(100% + .3rem);background:white;border:1px solid #a9bab0;border-radius:.45rem;box-shadow:0 .3rem 1rem #12332319;overflow-y:auto;max-height:17rem}
.met-sugs [role=option],.met-resultados a{display:flex;align-items:baseline;justify-content:space-between;gap:.65rem;min-height:44px;padding:.65rem .85rem;box-sizing:border-box}
.met-sugs [role=option]{cursor:pointer}
.met-sugs [aria-selected=true],.met-sugs [role=option]:hover,.met-resultados a:hover{background:#edf4ea}
.met-sugs strong,.met-resultados strong{min-width:0;overflow-wrap:anywhere}
.met-sugs small,.met-resultados small{color:#49594c;max-width:45%;flex-shrink:0;text-align:right;overflow-wrap:anywhere}
.met-resultados{border:1px solid #ccdad0;border-radius:.45rem;max-width:40rem}
.met-resultados li+li{border-top:1px solid #dfe6dc}
.met-resultados a{color:#214e30;text-decoration:none}
.met-solo-lector{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.met-error{margin:.6rem 0;color:#7c291b;font-size:.95rem}
.met-error p{margin:0 0 .4rem}.met-error button{font:inherit;padding:.5rem .8rem;border:1px solid #839788;border-radius:.4rem;background:white;color:#214e30;cursor:pointer}
`

export function resultadosMunicipios(consulta: string, resultados: ResultadoTiempo[], ambito: '/tiempo' | '/itv'): string {
  if (!consulta.trim()) return ''
  if (!resultados.length) return '<p>No encontramos ese lugar. Prueba con otro nombre o <a href="' + ambito + '/">consulta la lista de provincias</a>.</p>'
  return '<ul class="met-resultados">' + resultados.map(r =>
    '<li><a href="' + esc(r.u) + '"><strong>' + esc(r.n) + '</strong><small>'
    + (r.tipo === 'provincia' ? 'Provincia' : esc(r.p) + ' · Municipio') + '</small></a></li>').join('') + '</ul>'
}

export function buscadorMunicipios(nonce: string, consulta: string, ambito: '/tiempo' | '/itv'): string {
  return '<form class="met-buscador" role="search" action="' + ambito + '/buscar" method="get">'
    + '<label for="met-q">Buscar municipio o provincia</label>'
    + '<div class="met-campo"><input id="met-q" name="q" type="search" autocomplete="off" maxlength="80" required '
    + 'placeholder="Nombre del municipio" value="' + esc(consulta) + '" />'
    + '<button type="submit">Buscar</button><ul id="met-sugs" class="met-sugs" role="listbox" aria-label="Sugerencias" hidden></ul></div>'
    + '<span class="met-solo-lector" id="met-estado" role="status"></span>'
    + '<div class="met-error" id="met-error" role="alert" hidden><p>No se pudo consultar el listado. Vuelve a intentarlo o pulsa Buscar.</p><button type="button" id="met-reintentar">Reintentar</button></div></form>'
    + `<script nonce="${esc(nonce)}">
(function(){
  const ambito=${JSON.stringify(ambito)};
  const input=document.getElementById('met-q'), box=document.getElementById('met-sugs'), estado=document.getElementById('met-estado');
  const error=document.getElementById('met-error'), reintentar=document.getElementById('met-reintentar');
  input.setAttribute('role','combobox'); input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-controls',box.id); input.setAttribute('aria-expanded','false');
  let timer, peticion, activo=-1, lugares=[];
  function cerrar(){
    clearTimeout(timer); if(peticion) peticion.abort();
    lugares=[]; activo=-1; box.hidden=true; box.replaceChildren(); estado.textContent='';
    input.removeAttribute('aria-activedescendant'); input.setAttribute('aria-expanded','false');
  }
  function ir(i){if(lugares[i])window.location.assign(lugares[i].u)}
  function elegir(i){
    if(!lugares[i])return;
    if(activo>=0)box.children[activo].setAttribute('aria-selected','false');
    activo=i; const opcion=box.children[i]; opcion.setAttribute('aria-selected','true');
    input.setAttribute('aria-activedescendant',opcion.id); opcion.scrollIntoView({block:'nearest'});
  }
  async function cargar(q){
    const req=new AbortController(); peticion=req; error.hidden=true;
    try{
      const res=await fetch('/api' + ambito + '/municipios?q='+encodeURIComponent(q),{signal:req.signal});
      if(!res.ok)throw Error('buscador');
      const datos=await res.json();
      if(req.signal.aborted||input.value.trim()!==q)return;
      if(!Array.isArray(datos))throw Error('buscador');
      lugares=datos.filter(r=>typeof r.u==='string'&&r.u.startsWith(ambito + '/'));
      for(const [i,r] of lugares.entries()){
        const li=document.createElement('li'), n=document.createElement('strong'), p=document.createElement('small');
        li.id='met-sug-'+i; li.setAttribute('role','option'); li.setAttribute('aria-selected','false');
        n.textContent=r.n; p.textContent=r.tipo==='provincia'?'Provincia':r.p+' · Municipio'; li.append(n,p);
        li.addEventListener('mousedown',e=>e.preventDefault()); li.addEventListener('click',()=>ir(i)); box.append(li);
      }
      box.hidden=lugares.length===0; input.setAttribute('aria-expanded',String(!box.hidden));
      estado.textContent=lugares.length?lugares.length+' sugerencias.':'No hay coincidencias.';
    }catch(e){if(!req.signal.aborted)error.hidden=false}
  }
  input.addEventListener('input',()=>{cerrar(); error.hidden=true; const q=input.value.trim(); if(q.length>=2)timer=setTimeout(()=>cargar(q),170)});
  reintentar.addEventListener('click',()=>{cerrar(); input.focus(); const q=input.value.trim(); if(q.length>=2)cargar(q)});
  input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){cerrar();return}
    if(!lugares.length)return;
    if(e.key==='ArrowDown'){e.preventDefault();elegir(Math.min(activo+1,lugares.length-1))}
    else if(e.key==='ArrowUp'){e.preventDefault();elegir(activo<0?lugares.length-1:Math.max(0,activo-1))}
    else if(e.key==='Enter'&&activo>=0){e.preventDefault();ir(activo)}
  });
  input.addEventListener('blur',cerrar);
})();</script>`
}

