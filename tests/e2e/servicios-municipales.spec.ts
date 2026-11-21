import {test,expect,type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {buildServiciosMunicipales} from '../../src/html/servicios-municipales'
import {landingHeaders} from '../../src/html/landing'
import type {CatalogoMunicipal,ResumenMunicipal} from '../../src/lib/servicios-municipales'

function sample(stale=false){
  const now=Date.now(),ts=new Date(now-1000).toISOString()
  const catalogo:CatalogoMunicipal={schema:1,radioM:5000,muestra:12,consultado:ts,fechaDatos:new Date(now-(stale?74:24)*3600000).toISOString(),centros:{fuente:'AEMET maestro/municipios',generado:'2026-09-06T17:05:00.176Z',consultado:ts,sha256:'a'.repeat(64)},fuente:{url:'https://www.openstreetmap.org/copyright',licencia:'ODbL-1.0',atribucion:'© OpenStreetMap contributors',indexSha256:'b'.repeat(64)},totalPuntos:100,totalCentros:2,conResultados:1,sinResultados:1,provincias:[]}
  const resumen:ResumenMunicipal={ine:'28079',nombre:'Madrid',slug:'madrid',provincia:'Madrid',provinciaSlug:'madrid',centro:{lat:40.4168,lon:-3.7038},radioM:5000,total:35,categorias:{bibliotecas:15,banos:10,'centros-culturales':10},lugares:Array.from({length:12},(_,i)=>({id:'osm-node-'+(i+1),nombre:i===0?'Biblioteca municipal de nombre largo y con información publicada por su fuente':i===1?'<img src=x onerror=alert(1)>':'Lugar de prueba '+i,categorias:['bibliotecas'],lat:40.4168+i*.00001,lon:-3.7038,zona:'521-705',distanciaM:i*20,ubicacion:'punto',direccion:'Calle de la información publicada, número '+i,municipio:i===2?'Municipio vecino':'Madrid',fechaEdicion:'2020-01-01T00:00:00Z'}))}
  return {catalogo,resumen}
}
async function fixture(page:Page,stale=false){
  const data=sample(stale)
  await page.route('**/servicios/municipio/28079/madrid',route=>route.fulfill({status:200,headers:{...landingHeaders('e2e-municipios'),'X-Robots-Tag':'noindex, follow'},body:buildServiciosMunicipales({nonce:'e2e-municipios',canonical:'https://webapp-3ft.pages.dev/servicios/municipio/28079/madrid',...data})}))
  return data
}
for(const width of [1280,390,320])test('proximidad municipal legible y accesible a '+width,async({page},info)=>{
  test.skip(info.config.metadata.live===true,'Prueba de diseño con datos artificiales; la fuente real se verifica aparte.')
  await page.setViewportSize({width,height:900});await fixture(page)
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  const response=await page.goto('/servicios/municipio/28079/madrid')
  expect(response?.headers()['x-robots-tag']).toBe('noindex, follow')
  await expect(page.getByRole('heading',{level:1})).toHaveText('Servicios cerca de Madrid')
  await expect(page.locator('.sm-card')).toHaveCount(12)
  await expect(page.locator('.sm-main')).toContainText('5 km en línea recta')
  await expect(page.locator('.sm-main')).toContainText('Municipio indicado en la ficha: Municipio vecino')
  await expect(page.locator('.sm-main')).toContainText('Real Observatorio')
  await expect(page.locator('.sm-card img')).toHaveCount(0)
  await expect(page.locator('.sm-main a[href^="javascript:"]')).toHaveCount(0)
  await expect(page.locator('.sm-main')).toContainText('Esta página presenta 12 de 35 lugares')
  await expect(page.getByRole('link',{name:'Bibliotecas'})).toHaveAttribute('href','/cerca?municipio=28079&categorias=bibliotecas')
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect((await new AxeBuilder({page}).include('.sm-main').analyze()).violations).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({path:info.outputPath('municipios-'+width+'.png'),fullPage:true})
})
test('muestra la copia antigua y no la oculta tras la consulta de hoy',async({page},info)=>{
  test.skip(info.config.metadata.live===true,'Fechas artificiales para probar el aviso.')
  await fixture(page,true);await page.goto('/servicios/municipio/28079/madrid')
  await expect(page.getByText('Esta copia está pendiente de actualizar.',{exact:true})).toBeVisible()
  await expect(page.locator('.sm-card')).toHaveCount(12)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex,follow')
})
test('la ficha funciona con JavaScript desactivado',async({browser},info)=>{
  test.skip(info.config.metadata.live===true,'Contenido controlado para comprobar SSR sin JavaScript.')
  const page=await browser.newPage({javaScriptEnabled:false,baseURL:String(info.project.use.baseURL),serviceWorkers:'block'})
  try{await fixture(page);await page.goto('/servicios/municipio/28079/madrid');await expect(page.locator('.sm-card')).toHaveCount(12);await expect(page.getByRole('link',{name:'Ver ficha y cómo llegar →'}).first()).toHaveAttribute('href',/servicio=osm-node-1/)}finally{await page.close()}
})
test('smoke real del directorio generado por el robot',async({page},info)=>{
  test.skip(info.config.metadata.live!==true,'Sólo con un directorio real generado; no depende de fixtures.')
  for(const [ine,slug,nombre] of [['28079','madrid','Madrid'],['48027','durango','Durango'],['51001','ceuta','Ceuta']]){
    const r=await page.goto('/servicios/municipio/'+ine+'/'+slug)
    expect(r?.status()).toBe(200);await expect(page.getByRole('heading',{level:1})).toHaveText('Servicios cerca de '+nombre)
    expect(await page.locator('.sm-card').count()).toBeGreaterThan(0)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex,follow')
    expect(await page.locator('.sm-card').count()).toBeLessThanOrEqual(12)
    await page.screenshot({path:info.outputPath('real-'+slug+'.png'),fullPage:true})
  }
  await page.setViewportSize({width:390,height:844});await page.goto('/servicios/municipio/48027/durango')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:info.outputPath('real-durango-movil.png'),fullPage:true})
})
