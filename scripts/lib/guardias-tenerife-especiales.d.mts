type Celda = { x: number; y: number; texto: string }
export function turnosEspeciales(paginas: Celda[][], zona: string | number, fecha: string): Array<{
  nombre: string; direccion: string; telefono: string; horario: string; nota: string
}> | null
