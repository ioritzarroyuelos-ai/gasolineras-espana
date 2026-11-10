import {expect,test} from '@playwright/test'
import {ministryFixture} from './ministry-fixture'

test('Tui: coordenadas oficiales invertidas no crean marcador ni ruta equivocada',async({page,request},info)=>{
  test.skip(info.config.metadata.live===true,'Caso controlado de coordenadas erróneas; no sustituye datos en producción.')
  await ministryFixture(page,request)
  await page.route('**/api/estaciones/**',route=>route.fulfill({json:{Fecha:'10/11/2026 16:19:06',ListaEESSPrecio:[{
    IDEESS:'16268',IDProvincia:'36',IDMunicipio:'5322',Provincia:'PONTEVEDRA',Municipio:'Tui',Localidad:'TUI',
    'Rótulo':'GUAY','Dirección':'CARRETERA ANTA KM. 1','C.P.':'36700',Horario:'L-D: 06:00-23:00',
    Latitud:'-8,659472','Longitud (WGS84)':'42,037472','Precio Gasolina 95 E5':'1,499',
  }]}}))
  await page.route('**/api/history/16268?*',route=>route.fulfill({json:{series:{'95':[
    {date:'2026-11-07',price:1.5},{date:'2026-11-08',price:1.6},{date:'2026-11-10',price:1.7},
  ]},missing_dates:{'95':['2026-11-09']}}}))
  await page.goto('/gasolineras/mapa?prov=36&mun=5322')
  const card=page.locator('.station-card').filter({has:page.locator('[data-fav-id="16268"]')})
  await expect(card).toBeVisible({timeout:15000})
  await card.click()
  const detail=page.locator('#station-detail')
  await expect(detail).toHaveAttribute('data-station-id','16268')
  await expect(detail).toContainText('Ubicación en el mapa pendiente de confirmar')
  await expect(detail).toContainText('Falta la captura de 1 día')
  await expect(detail.locator('a[href*="-8.659472"]')).toHaveCount(0)
  await expect(page.locator('.station-price-marker[data-station-id="16268"]')).toHaveCount(0)
  await page.screenshot({path:info.outputPath('tui-ubicacion-pendiente.png')})
})
