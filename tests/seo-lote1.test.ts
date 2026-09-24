import { describe, it, expect } from 'vitest'
import { buildPage } from '../src/html/shell'
import { buildLandingPage } from '../src/html/landing'

describe('SEO Lote 1 — builders', () => {
  it('gasolineras: el title de provincia lleva la marca al final', () => {
    const html = buildPage('n1', 'https://webapp-3ft.pages.dev/gasolineras/madrid', {
      seo: { provinciaId: '13', provinciaSlug: 'madrid', provinciaName: 'Madrid' },
    })
    expect(html).toMatch(/<title>Gasolineras en Madrid: precios \| España Útil<\/title>/)
  })

  it('gasolineras: el mapa (sin geo) mantiene la marca en el title', () => {
    const html = buildPage('n1', 'https://webapp-3ft.pages.dev/gasolineras/mapa', { mapTool: true })
    expect(html).toContain('España Útil')
    expect(html).toContain('<title>')
  })

  it('portada: H1 descriptivo (sr-only) y la marca ya NO es H1', () => {
    const html = buildLandingPage('n1', 'https://webapp-3ft.pages.dev/')
    // H1 con términos de búsqueda, no la marca sola.
    expect(html).toMatch(/<h1 class="sr-only">[^<]*gasolineras[^<]*<\/h1>/i)
    // La marca en la cabecera es <span>, no <h1>.
    expect(html).not.toContain('<h1 class="mh-title">')
  })

  it('portada: JSON-LD con @id estables de WebSite y Organization', () => {
    const html = buildLandingPage('n1', 'https://webapp-3ft.pages.dev/')
    expect(html).toContain('/#website')
    expect(html).toContain('/#organization')
  })

  it('portada: og:image completo (width/height/alt) y twitter:image', () => {
    const html = buildLandingPage('n1', 'https://webapp-3ft.pages.dev/')
    expect(html).toContain('og:image:width')
    expect(html).toContain('og:image:height')
    expect(html).toContain('twitter:image')
    expect(html).toContain('content="#16a34a"') // theme-color unificado
  })
})
