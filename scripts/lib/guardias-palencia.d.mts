export function seleccionarSemanaPalencia<T extends { nombre: string }>(enlaces: T[], fecha: string): { enlace: T; lunes: Date; domingo: Date }
