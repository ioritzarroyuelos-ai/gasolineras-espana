// Marca del proyecto, en UN solo sitio. Hoy resuelve a "CercaYa"; cuando se
// decida el nombre definitivo (rebrand en curso) se cambia AQUI y se propaga a
// todo el render SSR. Nota: public/manifest.json es JSON estatico (no puede
// importar), asi que su name/short_name se mantienen en paralelo hasta que se
// genere en build. NO usar esta constante para claves/ids/scope/cookies (gs_*):
// esos son identidad tecnica, no marca, y no deben cambiar con el rebrand.
export const BRAND = 'CercaYa'
