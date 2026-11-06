// Emoji orientativo del estado del cielo (decorativo). Se decide por palabra
// clave sobre el texto de AEMET ("Despejado", "Intervalos nubosos con lluvia"…).
export function emojiCielo(cielo: string): string {
  const s = String(cielo || '').toLowerCase()
  if (/tormenta/.test(s)) return '⛈️'
  if (/nieve|nevad/.test(s)) return '🌨️'
  if (/lluvia|llovizna|chubasc|precipit|aguacero/.test(s)) return '🌧️'
  if (/niebla|bruma|calima/.test(s)) return '🌫️'
  if (/cubierto/.test(s)) return '☁️'
  if (/muy nuboso/.test(s)) return '🌥️'
  if (/nubos|nube|intervalos|nuboso/.test(s)) return '⛅'
  if (/despejado|sol/.test(s)) return '☀️'
  return '🌡️'
}
