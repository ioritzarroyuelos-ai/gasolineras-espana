import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export async function paginasConPosicion(datos) {
  const tarea = getDocument({ data: new Uint8Array(datos), useSystemFonts: true, isEvalSupported: false })
  try {
    const pdf = await tarea.promise
    const paginas = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const pagina = await pdf.getPage(i)
      const vista = pagina.getViewport({ scale: 1 })
      const contenido = await pagina.getTextContent()
      paginas.push(contenido.items.filter(item => item.str?.trim()).map(item => {
        const [x, y] = vista.convertToViewportPoint(item.transform[4], item.transform[5])
        return { x: x / vista.width, y: y / vista.height, texto: item.str.trim() }
      }))
    }
    return paginas
  } finally { await tarea.destroy() }
}
