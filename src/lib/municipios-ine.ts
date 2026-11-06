import type { LocalidadIndex } from './localidades'
import { PROVINCIAS } from './provincias'

// Diferencias entre el catálogo meteorológico y los códigos municipales del INE.
// https://www.ine.es/daco/daco42/codmun/26codmun.xlsx
// https://www.ine.es/daco/daco42/codmun/codmun_anual.htm (6 de noviembre de 2026).
const altas: Record<string, string> = {
  '04904': "Balanegra",
  '11903': "San Martín del Tesorillo",
  '14901': "Fuente Carreteros",
  '14902': "Guijarrosa, La",
  '18077': "Fornes",
  '18106': "Játar",
  '18915': "Domingo Pérez de Granada",
  '18916': "Torrenueva Costa",
  '21902': "Zarza-Perrunal, La",
  '36902': "Cerdedo Cotobade",
  '41904': "Palmar de Troya, El",
  '48916': "Usansolo",
}
const nombres: Record<string, string[]> = {
  '01047': ["Ribera Baja/Erriberabeitia","Ribera Baja/Erribera Beitia"],
  '01051': ["Agurain/Salvatierra","Salvatierra/Agurain"],
  '03007': ["Alcosser","Alcocer de Planes"],
  '03009': ["Alcoi/Alcoy","Alcoy/Alcoi"],
  '03014': ["Alacant/Alicante","Alicante/Alacant"],
  '03027': ["Beniardà","Beniardá"],
  '03042': ["Poble Nou de Benitatxell, el/Benitachell","Benitachell/Poble Nou de Benitatxell, el"],
  '03051': ["Camp de Mirra, el/Campo de Mirra","Campo de Mirra/Camp de Mirra, el"],
  '03065': ["Elx/Elche","Elche/Elx"],
  '03067': ["Fageca","Facheca"],
  '03082': ["Xàbia/Jávea","Jávea/Xàbia"],
  '03083': ["Xixona/Jijona","Jijona/Xixona"],
  '03084': ["Orxa, l'/Lorcha","Lorcha/Orxa, l'"],
  '03089': ["Monòver/Monóvar","Monóvar/Monòver"],
  '03122': ["Sant Vicent del Raspeig/San Vicente del Raspeig","San Vicente del Raspeig/Sant Vicent del Raspeig"],
  '03132': ["Torre de les Maçanes, la/Torremanzanas","Torremanzanas/Torre de les Maçanes, la"],
  '03136': ["Vall de Gallinera, la","Vall de Gallinera"],
  '03139': ["Vila Joiosa, la/Villajoyosa","Villajoyosa/Vila Joiosa, la"],
  '04004': ["Albanchez","Albánchez"],
  '04054': ["Íllar","Illar"],
  '04057': ["Laujar de Andarax","Láujar de Andarax"],
  '06903': ["Guadiana","Guadiana del Caudillo"],
  '07032': ["Maó","Maó-Mahón"],
  '07040': ["Palma","Palma de Mallorca"],
  '08023': ["Bigues i Riells del Fai","Bigues i Riells"],
  '09090': ["Castrillo Mota de Judíos","Castrillo Matajudíos"],
  '09353': ["Santa María Ribarredonda","Santa María Rivarredonda"],
  '10016': ["Aldehuela del Jerte","Aldehuela de Jerte"],
  '10097': ["Higuera de Albalat","Higuera"],
  '11023': ["Medina Sidonia","Medina-Sidonia"],
  '12009': ["Almassora","Almazora/Almassora"],
  '12026': ["Benassal","Benasal"],
  '12028': ["Benicàssim/Benicasim","Benicasim/Benicàssim"],
  '12029': ["Benlloc","Benlloch"],
  '12040': ["Castelló de la Plana/Castellón de la Plana","Castelló de la Plana"],
  '12055': ["Xodos/Chodos","Chodos/Xodos"],
  '12068': ["Herbers","Herbés"],
  '12072': ["Llucena/Lucena del Cid","Lucena del Cid"],
  '12085': ["Orpesa/Oropesa del Mar","Oropesa del Mar/Orpesa"],
  '12108': ["Suera/Sueras","Sueras/Suera"],
  '12119': ["Torre d'en Besora, la","Torre d'En Besora, la"],
  '12122': ["Useres, les/Useras","Useras/Useres, les"],
  '12129': ["Vilafranca/Villafranca del Cid","Villafranca del Cid/Vilafranca"],
  '15071': ["Porto do Son, O","Porto do Son"],
  '15902': ["Oza Cesuras","Oza-Cesuras"],
  '16173': ["Valle de Altomira, El","Valle de Altomira, el"],
  '17028': ["Brunyola i Sant Martí Sapresa","Brunyola"],
  '17034': ["Calonge i Sant Antoni","Calonge"],
  '17048': ["Castell d'Aro, Platja d'Aro i s'Agaró","Castell-Platja d'Aro"],
  '17100': ["Masarac i Vilarnadal","Masarac"],
  '17118': ["Palamós i Sant Joan","Palamós"],
  '18094': ["Güéjar Sierra","Güejar Sierra"],
  '18102': ["Íllora","Illora"],
  '18103': ["Ítrabo","Itrabo"],
  '18108': ["Jérez del Marquesado","Jerez del Marquesado"],
  '18906': ["Guájares, Los","Guajares, Los"],
  '23032': ["Espeluy","Espelúy"],
  '24036': ["Valle de Ancares","Candín"],
  '26091': ["Lumbreras de Cameros","Lumbreras"],
  '27002': ["Alfoz do Castrodouro","Alfoz"],
  '27044': ["Pastoriza","Pastoriza, A"],
  '27053': ["Ribeira de Piquín, A","Ribeira de Piquín"],
  '31040': ["Atetz","Atez/Atetz"],
  '31071': ["Castillonuevo/Gazteluberri","Castillonuevo"],
  '31083': ["Echarri/Etxarri","Echarri"],
  '31088': ["Valle de Elorz/Elortzibar","Noáin (Valle de Elorz)/Noain (Elortzibar)"],
  '31118': ["Val de Goñi/Goñerri","Goñi"],
  '31136': ["Juslapeña/Txulapain","Juslapeña"],
  '31154': ["Lezaun","Lezáun"],
  '31156': ["Lizoain-Arriasgoiti/Lizoainibar-Arriasgoiti","Lizoáin-Arriasgoiti"],
  '31167': ["Mendigorria","Mendigorría"],
  '31194': ["Valle de Ollo/Ollaran","Ollo"],
  '31207': ["Pueyo/Puiu","Pueyo"],
  '31209': ["Romanzado/Erromantzatua","Romanzado"],
  '31235': ["Ujué/Uxue","Ujué"],
  '31243': ["Urroz Villa/Urrotz","Urroz-Villa"],
  '31901': ["Barañáin/Barañain","Barañain"],
  '32023': ["Castro de Caldelas, O","Castro Caldelas"],
  '32071': ["Riós, O","Riós"],
  '36007': ["Campo Lameiro, O","Campo Lameiro"],
  '36008': ["Cangas de Morrazo","Cangas"],
  '36009': ["Caniza, A","Cañiza, A"],
  '36031': ["Mondariz Balneario","Mondariz-Balneario"],
  '37118': ["Éjeme","Ejeme"],
  '40161': ["Carabias","Pradales"],
  '43027': ["Bisbal de Montsant, La","Bisbal de Falset, La"],
  '43136': ["Ràpita, La","Sant Carles de la Ràpita"],
  '45079': ["Iglesuela del Tiétar, La","Iglesuela, La"],
  '46013': ["Alboraia/Alboraya","Alboraya"],
  '46026': ["Alfarb","Alfarp"],
  '46028': ["Algar de Palància","Algar de Palancia"],
  '46030': ["Algímia d'Alfara","Algimia de Alfara"],
  '46067': ["Benissanó","Benisanó"],
  '46069': ["Benissuera","Benisuera"],
  '46119': ["Énova, l'","Ènova, l'"],
  '46127': ["Font d'en Carròs, la","Font d'En Carròs, la"],
  '46132': ["Genovés, el","Genovés"],
  '46170': ["Moixent/Mogente","Mogente/Moixent"],
  '46171': ["Montcada/Moncada","Moncada"],
  '46178': ["Nàquera/Náquera","Náquera"],
  '46180': ["Novetlè","Novelé/Novetlè"],
  '46204': ["Puig de Santa Maria, el","Puig de Santa María, el"],
  '46210': ["Ràfol de Salem, el","Ráfol de Salem"],
  '46211': ["Real de Gandia, el","Real de Gandía"],
  '46218': ["Ròtova","Rótova"],
  '46220': ["Sagunt/Sagunto","Sagunto/Sagunt"],
  '46250': ["València","Valencia"],
  '46257': ["Castelló","Villanueva de Castellón"],
  '48009': ["Arrankudiaga-Zollo","Arrankudiaga"],
  '50130': ["Jarque de Moncayo","Jarque"],
}
const bajas = new Set(['36011', '36012']) // Cerdedo y Cotobade se fusionaron en 36902.
const provincias = new Map(PROVINCIAS.map(p => [p.id, p.name]))

export function municipiosINE(base: LocalidadIndex[], provincia?: string): LocalidadIndex[] {
  const lista = base.filter(m => !bajas.has(m.ine)).map(m => {
    const nombre = nombres[m.ine]?.[0] || altas[m.ine] || m.nombre
    return nombre === m.nombre ? m : { ...m, nombre }
  })
  const existentes = new Set(lista.map(m => m.ine))
  for (const [ine, nombre] of Object.entries(altas)) {
    const id = ine.slice(0, 2)
    if ((!provincia || provincia === id) && !existentes.has(ine)) {
      lista.push({ ine, nombre, provinciaNombre: provincias.get(id)! })
    }
  }
  return lista
}

export function nombresDelINE(ine: string): readonly string[] {
  return nombres[ine] || []
}

export function municipioFusionado(provincia: string, slug: string): string | undefined {
  if (provincia === '36' && (slug === 'cerdedo' || slug === 'cotobade')) return 'cerdedo-cotobade'
}
