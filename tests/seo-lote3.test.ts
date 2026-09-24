import { describe, it, expect } from 'vitest'
import { buildPage } from '../src/html/shell'
import { getStyles } from '../src/html/styles'

describe('SEO Lote 3 — rendimiento', () => {
  it('sin FontAwesome: no hay <i class=fa> ni CDN; hay sprite SVG inline', () => {
    const html = buildPage('n', 'https://x/gasolineras/mapa', { mapTool: true })
    expect(html).not.toContain('fontawesome')
    expect(html).not.toContain('cdn.jsdelivr.net')
    expect(html).not.toContain('class="fas ')
    expect(html).toContain('<symbol id="i-bars"')   // sprite presente
    expect(html).toContain('#i-bars')                 // se referencia con <use>
  })

  it('canonicalOrigin fuerza canonical/OG al origen canónico (no al host del preview)', () => {
    const html = buildPage('n', 'https://preview-abc.pages.dev/gasolineras/madrid', {
      canonicalOrigin: 'https://webapp-3ft.pages.dev',
      seo: { provinciaId: '13', provinciaSlug: 'madrid', provinciaName: 'Madrid' },
    })
    expect(html).toContain('https://webapp-3ft.pages.dev/gasolineras/madrid')
    expect(html).not.toContain('preview-abc.pages.dev')
  })

  it('CSS crítico minificado: sin comentarios ni sangría de 4 espacios', () => {
    const css = getStyles('n1')
    expect(css).not.toContain('/*')
    expect(css).not.toContain('\n    ')
    expect(css).toContain('.ic {')  // el estilo de los iconos SVG está presente
  })
})
