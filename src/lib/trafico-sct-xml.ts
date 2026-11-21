// Lector XML deliberadamente pequeño para los dos ficheros públicos del SCT.
// No interpreta DTD, entidades personalizadas, instrucciones ni recursos externos.
export type SctXmlNode = { tag: string; attrs: Record<string, string>; children: SctXmlNode[]; value: string }
const invalid = (): never => { throw Error('XML de tráfico no reconocido') }
function decoded(value: string): string {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(value)) return invalid()
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, code: string) => {
    const known: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (known[code] !== undefined) return known[code]
    const point = code.startsWith('#x') ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    if (!Number.isInteger(point) || point <= 0 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff || point < 32 && ![9, 10, 13].includes(point)) return invalid()
    return String.fromCodePoint(point)
  })
}
export function parseSctXml(input: string): SctXmlNode {
  if (!input || input.length > 2 * 1024 * 1024 || /<!|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)) return invalid()
  let value = input.replace(/^\uFEFF/, '').replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/i, '')
  if (value.includes('<?')) return invalid()
  const stack: SctXmlNode[] = [], roots: SctXmlNode[] = []
  const tokens = /<[^>]*>|[^<]+/g
  let last = 0, count = 0
  for (const match of value.matchAll(tokens)) {
    if (match.index !== last) return invalid()
    const token = match[0]; last += token.length
    if (!token.startsWith('<')) {
      if (!stack.length) { if (token.trim()) return invalid() } else stack.at(-1)!.value += decoded(token)
      continue
    }
    if (token.length > 4096) return invalid()
    const close = /^<\/([a-zA-Z_][\w.:-]*)\s*>$/.exec(token)
    if (close) {
      if (stack.pop()?.tag !== close[1]) return invalid()
      continue
    }
    const open = /^<([a-zA-Z_][\w.:-]*)([\s\S]*?)(\/?)>$/.exec(token)
    if (!open || stack.length >= 24 || ++count > 60000) return invalid()
    const attrs: Record<string, string> = Object.create(null)
    const pattern = /\s+([a-zA-Z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y
    let position = 0
    while (position < open[2].length) {
      if (!open[2].slice(position).trim()) break
      pattern.lastIndex = position
      const attr = pattern.exec(open[2])
      if (!attr || Object.hasOwn(attrs, attr[1]) || (attr[2] ?? attr[3]).includes('<')) return invalid()
      attrs[attr[1]] = decoded(attr[2] ?? attr[3]); position = pattern.lastIndex
    }
    const node: SctXmlNode = { tag: open[1], attrs, children: [], value: '' }
    if (stack.length) stack.at(-1)!.children.push(node); else roots.push(node)
    if (!open[3]) stack.push(node)
  }
  if (last !== value.length || stack.length || roots.length !== 1) return invalid()
  return roots[0]
}
export function sctOne(parent: SctXmlNode, tag: string): SctXmlNode {
  const values = parent.children.filter(node => node.tag === tag)
  if (values.length !== 1) return invalid()
  return values[0]
}
export function sctText(parent: SctXmlNode, tag: string, max = 600): string {
  const node = sctOne(parent, tag), value = node.value.trim()
  if (node.children.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return invalid()
  return value
}
