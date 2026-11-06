type Celda = { x: number; y: number; texto: string }
type Turno = { nombre: string; direccion: string; telefono: string; horario: string; nota: string }
export const calendarioTenerife: string
export function turnosDeUnaColumna(pagina: Celda[], zona: string, fecha: string): Turno[]
export function consultarCalendarios(fecha: string): Promise<{ turnos: (Turno & { zona: string; dia: string })[]; pendientes: string[] }>
