// Catálogo compartido por robot, API y navegador. Los filtros no prometen
// horarios, reservas ni disponibilidad que OpenStreetMap no publique.
export const SERVICIOS_CATEGORIAS = [
  ['aparcamientos','Aparcamientos','movilidad'], ['talleres','Talleres mecánicos','movilidad'],
  ['neumaticos','Talleres de neumáticos','movilidad'], ['lavaderos','Lavaderos de coches','movilidad'],
  ['autocaravanas','Áreas de autocaravanas','movilidad'], ['asistencia-carretera','Asistencia en carretera','movilidad'],
  ['areas-descanso','Áreas de servicio y descanso','movilidad'], ['butano','Bombonas de gas','movilidad'],
  ['peajes','Peajes','movilidad'], ['autobuses','Estaciones de autobús','transporte'],
  ['trenes','Estaciones de tren','transporte'], ['metro','Estaciones de metro','transporte'],
  ['paradas','Paradas de transporte público','transporte'], ['taxis','Paradas de taxi','transporte'],
  ['bicicletas-publicas','Estaciones de bicicletas de alquiler','transporte'], ['aparcabicis','Aparcamientos para bicicletas','transporte'],
  ['reparacion-bicicletas','Reparación de bicicletas','transporte'], ['farmacias','Farmacias','salud'],
  ['hospitales','Hospitales','salud'], ['centros-salud','Centros de salud','salud'],
  ['urgencias','Servicios de urgencias','salud'], ['desfibriladores','Desfibriladores','salud'],
  ['veterinarios','Veterinarios','salud'], ['donacion-sangre','Donación de sangre','salud'],
  ['refugios-climaticos','Refugios climáticos','salud'], ['puntos-violeta','Puntos Violeta','salud'],
  ['ascensores','Ascensores','salud'], ['banos','Baños','cotidiano'],
  ['agua-potable','Fuentes de agua potable','cotidiano'], ['cajeros','Cajeros','cotidiano'],
  ['supermercados','Supermercados','cotidiano'], ['mercados','Mercados y mercadillos','cotidiano'],
  ['correos','Oficinas postales','cotidiano'], ['paqueteria','Recogida de paquetes','cotidiano'],
  ['taquillas-paquetes','Taquillas de paquetes','cotidiano'], ['puntos-limpios','Puntos limpios','cotidiano'],
  ['reciclaje','Puntos de reciclaje','cotidiano'], ['donacion-ropa','Donación de ropa','cotidiano'],
  ['reciclaje-pilas','Reciclaje de pilas domésticas','cotidiano'], ['reciclaje-aceite','Reciclaje de aceite de cocina','cotidiano'],
  ['policia','Comisarías','publicos'], ['guardia-civil','Guardia Civil','publicos'],
  ['bomberos','Parques de bomberos','publicos'], ['sepe','Oficinas públicas de empleo','publicos'],
  ['seguridad-social','Seguridad Social','publicos'], ['hacienda','Hacienda','publicos'],
  ['dni-pasaporte','Oficinas de pasaportes','publicos'], ['atencion-ciudadana','Atención ciudadana','publicos'],
  ['bibliotecas','Bibliotecas','publicos'], ['salas-estudio','Salas de estudio','publicos'],
  ['wifi','Wifi público','publicos'], ['centros-culturales','Centros culturales','publicos'],
  ['parques','Parques','ocio'], ['parques-infantiles','Parques infantiles','ocio'],
  ['parques-perros','Parques para perros','ocio'], ['playas','Playas','ocio'],
  ['campings','Campings','ocio'], ['consignas','Consignas de equipaje','ocio'],
  ['piscinas','Piscinas','ocio'], ['polideportivos','Polideportivos','ocio'],
].map(([id,nombre,grupo])=>Object.freeze({id,nombre,grupo}))
export const SERVICIOS_IDS = new Set(SERVICIOS_CATEGORIAS.map(c=>c.id))
// Prefiltro nativo: reduce el PBF antes de resolver geometrías. La clasificación
// final exige todas las condiciones en categoriasServicio (incluidas las AND).
export const OSM_TAG_FILTERS = [
  ...['parking','car_wash','bicycle_parking','bicycle_rental','bicycle_repair_station','bus_station','taxi','pharmacy','hospital','clinic','doctors','veterinary','blood_donation','toilets','drinking_water','atm','marketplace','post_office','parcel_locker','recycling','police','fire_station','townhall','library','community_centre','arts_centre','luggage_locker','public_bath'].map(v=>['amenity',v]),
  ...['car_repair','tyres','gas','supermarket'].map(v=>['shop',v]),
  ['post_office:parcel_pickup','yes'],
  ...['park','playground','dog_park','swimming_pool','sports_centre','swimming_area'].map(v=>['leisure',v]),
  ...['camp_site','caravan_site'].map(v=>['tourism',v]),
  ...['services','rest_area','bus_stop','elevator'].map(v=>['highway',v]),
  ...['station','halt','subway_entrance'].map(v=>['railway',v]),
  ['public_transport','platform'],['public_transport','station'],['office','government'],
  ['emergency','defibrillator'],['emergency','yes'],['healthcare','blood_donation'],
  ['natural','beach'],['barrier','toll_booth'],['internet_access','wlan'],['drinking_water','yes'],
  ['shelter_type','climate_shelter'],['service:vehicle:roadside_assistance','yes'],
]
export function categoriasServicio(t) {
  const out = new Set(), add=(condition,id)=>{if(condition)out.add(id)}
  const a=t.amenity, shop=t.shop, leisure=t.leisure, highway=t.highway, rail=t.railway
  // Un aparcamiento se muestra una vez, no una tarjeta por cada plaza pintada.
  add(a==='parking','aparcamientos')
  add(shop==='car_repair','talleres'); add(shop==='tyres','neumaticos'); add(a==='car_wash','lavaderos')
  add(t.tourism==='caravan_site','autocaravanas'); add(t['service:vehicle:roadside_assistance']==='yes','asistencia-carretera')
  add(['services','rest_area'].includes(highway),'areas-descanso'); add(shop==='gas','butano'); add(t.barrier==='toll_booth','peajes')
  add(a==='bus_station','autobuses'); add(['station','halt'].includes(rail)&&t.station!=='subway'&&t.subway!=='yes','trenes')
  add(rail==='subway_entrance'||(rail==='station'&&(t.station==='subway'||t.subway==='yes')),'metro')
  add(highway==='bus_stop'||t.public_transport==='platform','paradas'); add(a==='taxi','taxis')
  add(a==='bicycle_rental','bicicletas-publicas'); add(a==='bicycle_parking','aparcabicis'); add(a==='bicycle_repair_station','reparacion-bicicletas')
  add(a==='pharmacy','farmacias'); add(a==='hospital','hospitales'); add(['clinic','doctors'].includes(a),'centros-salud')
  add(['hospital','clinic','doctors'].includes(a)&&t.emergency==='yes','urgencias')
  add(t.emergency==='defibrillator','desfibriladores'); add(a==='veterinary','veterinarios')
  add(a==='blood_donation'||t.healthcare==='blood_donation','donacion-sangre')
  add(t.shelter_type==='climate_shelter','refugios-climaticos'); add(highway==='elevator','ascensores')
  add(a==='toilets','banos'); add((a==='drinking_water'||t.drinking_water==='yes')&&t.drinking_water!=='no','agua-potable')
  add(a==='atm','cajeros'); add(shop==='supermarket','supermercados'); add(a==='marketplace','mercados')
  add(a==='post_office','correos')
  // Un comercio colaborador puede ofrecer sólo envío o cartas. Recogida de
  // paquetes requiere la etiqueta específica, también en tiendas corrientes.
  add(t['post_office:parcel_pickup']==='yes'&&!t['post_office:parcel_pickup:conditional'],'paqueteria')
  add(a==='parcel_locker','taquillas-paquetes')
  add(a==='recycling'&&t.recycling_type==='centre','puntos-limpios'); add(a==='recycling','reciclaje')
  add(a==='recycling'&&t['recycling:clothes']==='yes','donacion-ropa')
  add(a==='recycling'&&t['recycling:batteries']==='yes'&&!t['recycling:batteries:conditional'],'reciclaje-pilas')
  add(a==='recycling'&&t['recycling:cooking_oil']==='yes'&&!t['recycling:cooking_oil:conditional'],'reciclaje-aceite')
  const civil=a==='police'&&/guardia civil/i.test([t.operator,t.name,t['operator:wikidata']].filter(Boolean).join(' '))
  add(a==='police'&&!civil,'policia');add(civil,'guardia-civil'); add(a==='fire_station','bomberos')
  add(t.office==='government'&&t.government==='employment_agency','sepe')
  add(t.office==='government'&&t.government==='social_security','seguridad-social')
  add(t.office==='government'&&t.government==='tax','hacienda')
  add(t.office==='government'&&t.government==='passport','dni-pasaporte')
  add(a==='townhall'||(t.office==='government'&&t.government==='administrative'),'atencion-ciudadana')
  add(a==='library','bibliotecas'); add(a==='library'&&t.study_area==='yes','salas-estudio')
  add(t.internet_access==='wlan'&&t['internet_access:fee']==='no'&&t.access==='yes'&&!t['access:conditional']&&!t['internet_access:fee:conditional'],'wifi')
  add(['community_centre','arts_centre'].includes(a),'centros-culturales')
  add(leisure==='park','parques'); add(leisure==='playground','parques-infantiles'); add(leisure==='dog_park','parques-perros')
  add(t.natural==='beach','playas'); add(t.tourism==='camp_site','campings'); add(a==='luggage_locker','consignas')
  add((leisure==='swimming_pool'&&(['yes','permissive'].includes(t.access)||t['operator:type']==='public'||t.ownership==='municipal'))||a==='public_bath','piscinas'); add(leisure==='sports_centre','polideportivos')
  return [...out].sort()
}
