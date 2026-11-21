type Word = { x: number; y: number; texto: string }
export function calendarioCapitalUrl(html: string, periodo: string): string
export function parseCapitalCordoba(pages: Word[][], fecha: string, periodo: string): (string | number)[][]
export function consultaCapitalCordoba(fecha: string, readers: { html: (url: string) => Promise<string>; pdf: (url: string) => Promise<Uint8Array>; pages: (data: Uint8Array) => Promise<Word[][]> }): Promise<{ rows: (string | number)[][]; urls: string[] }>
