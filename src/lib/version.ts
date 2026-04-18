// Version visible de la aplicacion. Se actualiza a mano en cada release y se
// referencia desde el server (/api/health) y desde el cliente (console.info +
// reporte de errores).
//
// IMPORTANTE: el workflow de CI valida que esta constante coincida con el tag
// git del release (si el tag existe). Si cambias aqui, crea un tag 'vX.Y.Z'.
export const APP_VERSION = '1.4.10'
