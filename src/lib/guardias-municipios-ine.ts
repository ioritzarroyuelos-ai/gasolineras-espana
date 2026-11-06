import { slugsMunicipioGuardia, type LocalidadIndex } from './localidades'
import { nombresDelINE } from './municipios-ine'
export { municipiosINE as municipiosFarmacia, municipioFusionado } from './municipios-ine'

// Denominaciones abreviadas de la localidad de la oficina, cotejadas en los
// listados colegiales del 6/11. Se vinculan a un código; una pedanía mantiene su propia ficha.
const aliasDelColegio: Record<string, string> = {
  '02051': "Montealegre",
  '05021': "Barco de Ávila",
  '07015': "Ciutadella",
  '07046': "Sant Antoni",
  '07048': "Sant Josep",
  '07054': "Santa Eulalia",
  '11042': "Zahara de la Sierra",
  '12014': "Ares del Maestre",
  '12040': "Castellón",
  '13067': "Los Pozuelos",
  '14002': "Aguilar de la Fra.",
  '17140': "Port de la Selva",
  '17202': "Tossa",
  '33060': "S.M.R.A.",
  '35018': "San Bartolomé de Lanzarote",
  '41016': "Bollullos Mitación",
  '41025': "Carrión Céspedes",
  '41027': "Castilblanco de Arroyos",
  '41051': "Huévar",
  '41052': "La Lantejuela",
  '41077': "Puebla de Cazalla",
  '41079': "Puebla del Río",
  '41086': "San Juan Aznalfarache",
  '41096': "Valencina Concepción",
  '41099': "Villanueva Río y Minas",
  '43136': "S. Carles de la Ràpita",
  '43139': "Sta. Coloma de Queralt",
  '43902': "S. Jaume d’Enveja",
  '45100': "Mesegar",
  '45135': "Puebla de Almoradiel",
  '45172': "Torrico, el",
  '48002': "Abanto-Zierbena",
}

export function slugsFarmacia(m: Pick<LocalidadIndex, 'ine' | 'nombre'>): string[] {
  const anteriores = [...nombresDelINE(m.ine), ...(aliasDelColegio[m.ine] ? [aliasDelColegio[m.ine]] : [])]
  return [...new Set([m.nombre, ...anteriores].flatMap(nombre => slugsMunicipioGuardia({ ine: m.ine, nombre })))]
}
