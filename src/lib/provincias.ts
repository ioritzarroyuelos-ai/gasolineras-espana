// Mapping de provincias INE ↔ slug URL-safe para rutas SEO
// (/gasolineras/madrid, /gasolineras/barcelona, etc.).
//
// Usado en:
//  - src/index.tsx para resolver el slug en un ID y pre-renderizar metas.
//  - /sitemap.xml para declarar todas las paginas provinciales.
//
// Lista completa: 52 provincias (50 peninsulares + Ceuta + Melilla).
// ID = codigo INE a 2 digitos (same IDProvincia que usa el Ministerio).

export interface ProvinciaEntry {
  id: string       // "28"
  slug: string     // "madrid"
  name: string     // "Madrid" (para <title>, <h1>, sitemap)
}

export const PROVINCIAS: ReadonlyArray<ProvinciaEntry> = [
  { id: '01', slug: 'alava',                   name: 'Álava' },
  { id: '02', slug: 'albacete',                name: 'Albacete' },
  { id: '03', slug: 'alicante',                name: 'Alicante' },
  { id: '04', slug: 'almeria',                 name: 'Almería' },
  { id: '05', slug: 'avila',                   name: 'Ávila' },
  { id: '06', slug: 'badajoz',                 name: 'Badajoz' },
  { id: '07', slug: 'islas-baleares',          name: 'Islas Baleares' },
  { id: '08', slug: 'barcelona',               name: 'Barcelona' },
  { id: '09', slug: 'burgos',                  name: 'Burgos' },
  { id: '10', slug: 'caceres',                 name: 'Cáceres' },
  { id: '11', slug: 'cadiz',                   name: 'Cádiz' },
  { id: '12', slug: 'castellon',               name: 'Castellón' },
  { id: '13', slug: 'ciudad-real',             name: 'Ciudad Real' },
  { id: '14', slug: 'cordoba',                 name: 'Córdoba' },
  { id: '15', slug: 'a-coruna',                name: 'A Coruña' },
  { id: '16', slug: 'cuenca',                  name: 'Cuenca' },
  { id: '17', slug: 'girona',                  name: 'Girona' },
  { id: '18', slug: 'granada',                 name: 'Granada' },
  { id: '19', slug: 'guadalajara',             name: 'Guadalajara' },
  { id: '20', slug: 'guipuzcoa',               name: 'Guipúzcoa' },
  { id: '21', slug: 'huelva',                  name: 'Huelva' },
  { id: '22', slug: 'huesca',                  name: 'Huesca' },
  { id: '23', slug: 'jaen',                    name: 'Jaén' },
  { id: '24', slug: 'leon',                    name: 'León' },
  { id: '25', slug: 'lleida',                  name: 'Lleida' },
  { id: '26', slug: 'la-rioja',                name: 'La Rioja' },
  { id: '27', slug: 'lugo',                    name: 'Lugo' },
  { id: '28', slug: 'madrid',                  name: 'Madrid' },
  { id: '29', slug: 'malaga',                  name: 'Málaga' },
  { id: '30', slug: 'murcia',                  name: 'Murcia' },
  { id: '31', slug: 'navarra',                 name: 'Navarra' },
  { id: '32', slug: 'ourense',                 name: 'Ourense' },
  { id: '33', slug: 'asturias',                name: 'Asturias' },
  { id: '34', slug: 'palencia',                name: 'Palencia' },
  { id: '35', slug: 'las-palmas',              name: 'Las Palmas' },
  { id: '36', slug: 'pontevedra',              name: 'Pontevedra' },
  { id: '37', slug: 'salamanca',               name: 'Salamanca' },
  { id: '38', slug: 'santa-cruz-de-tenerife',  name: 'Santa Cruz de Tenerife' },
  { id: '39', slug: 'cantabria',               name: 'Cantabria' },
  { id: '40', slug: 'segovia',                 name: 'Segovia' },
  { id: '41', slug: 'sevilla',                 name: 'Sevilla' },
  { id: '42', slug: 'soria',                   name: 'Soria' },
  { id: '43', slug: 'tarragona',               name: 'Tarragona' },
  { id: '44', slug: 'teruel',                  name: 'Teruel' },
  { id: '45', slug: 'toledo',                  name: 'Toledo' },
  { id: '46', slug: 'valencia',                name: 'Valencia' },
  { id: '47', slug: 'valladolid',              name: 'Valladolid' },
  { id: '48', slug: 'bizkaia',                 name: 'Bizkaia' },
  { id: '49', slug: 'zamora',                  name: 'Zamora' },
  { id: '50', slug: 'zaragoza',                name: 'Zaragoza' },
  { id: '51', slug: 'ceuta',                   name: 'Ceuta' },
  { id: '52', slug: 'melilla',                 name: 'Melilla' },
]

// Indices O(1) para resolver en ambos sentidos.
const BY_SLUG = new Map<string, ProvinciaEntry>()
const BY_ID   = new Map<string, ProvinciaEntry>()
for (const p of PROVINCIAS) {
  BY_SLUG.set(p.slug, p)
  BY_ID.set(p.id, p)
}

export function provinciaBySlug(slug: string | undefined): ProvinciaEntry | null {
  if (!slug) return null
  return BY_SLUG.get(slug.toLowerCase()) || null
}
export function provinciaById(id: string | undefined): ProvinciaEntry | null {
  if (!id) return null
  return BY_ID.get(id) || null
}
