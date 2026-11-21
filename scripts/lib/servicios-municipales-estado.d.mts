export interface EstadoMunicipalItem {name:string;updatedAt:string|null;count:number;issue?:string}
export function estadoDerivacionMunicipal(raw:unknown,now?:number):EstadoMunicipalItem[]
export function estadoMaestroMunicipal(raw:unknown,catalog:unknown,now?:number):EstadoMunicipalItem[]
