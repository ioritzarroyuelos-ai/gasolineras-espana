# ⛽ Gasolineras España — Precios en tiempo real

## Descripción
Aplicación web que muestra los precios reales de las gasolineras en toda España, con datos oficiales actualizados directamente desde la API pública del **Ministerio de Industria, Comercio y Turismo** (MITECO).

## Funcionalidades completadas
- 🗺️ **Mapa interactivo** con Leaflet + clustering de marcadores
- 🎨 **Marcadores por color** según precio relativo (verde = barato, rojo = caro)
- 🔍 **Filtros** por provincia, municipio, tipo de combustible, rótulo y dirección
- 📋 **Lista lateral** con precio, dirección y horario de cada estación
- 📊 **Estadísticas** en tiempo real (precio mínimo, máximo y medio)
- 📍 **Geolocalización** para centrar el mapa en tu posición
- 📱 **Diseño responsive** para móvil y escritorio
- 🕐 **Datos en tiempo real** — actualizados por el Ministerio cada hora

## Combustibles disponibles
| Tipo | Código MINETUR |
|------|---------------|
| Gasolina 95 E5 | `Precio Gasolina 95 E5` |
| Gasolina 98 E5 | `Precio Gasolina 98 E5` |
| Gasóleo A (Diesel) | `Precio Gasoleo A` |
| Gasóleo Premium | `Precio Gasoleo Premium` |
| GLP (Autogas) | `Precio Gases licuados del petróleo` |
| Gas Natural (GNC) | `Precio Gas Natural Comprimido` |
| Gas Natural (GNL) | `Precio Gas Natural Licuado` |
| Hidrógeno | `Precio Hidrogeno` |
| Diésel Renovable | `Precio Diésel Renovable` |

## API utilizada
- **Fuente oficial**: [Ministerio de Industria - ServiciosRESTCarburantes](https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes)
- **Sin API key necesaria** — datos abiertos con CORS habilitado
- Actualización: cada hora aproximadamente

## Arquitectura
```
Frontend (HTML+JS) → API MINETUR (directa, CORS habilitado) → Datos en tiempo real
```

- **Backend**: Hono + Cloudflare Workers (sirve el HTML)
- **Frontend**: Vanilla JS + Leaflet + Tailwind CSS CDN + MarkerCluster
- **Datos**: API REST pública del Ministerio de Industria de España

## Stack técnico
- **Framework**: [Hono](https://hono.dev) v4
- **Runtime**: Cloudflare Workers / Pages
- **Mapa**: [Leaflet](https://leafletjs.com) 1.9.4 + MarkerCluster
- **Estilos**: Tailwind CSS (CDN)
- **Build**: Vite + @hono/vite-cloudflare-pages

## Desarrollo local
```bash
npm install
npm run build
pm2 start ecosystem.config.cjs  # o: npx wrangler pages dev dist --port 3000
```

## Despliegue en Cloudflare Pages
```bash
npm run build
npx wrangler pages deploy dist --project-name gasolineras-espana
```

## Próximos pasos sugeridos
- [ ] Filtro por precio máximo (slider)
- [ ] Comparador de gasolineras seleccionadas
- [ ] Vista de historial de precios por fecha
- [ ] Notificaciones cuando el precio baje de un umbral
- [ ] PWA (instalable en móvil)
- [ ] Exportar lista a CSV/PDF

## Licencia de datos
Datos proporcionados por el Ministerio de Industria, Comercio y Turismo de España bajo licencia de datos abiertos. Actualización horaria.
