import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
export function transporteFixture(mode = 'valid') {
  const result = spawnSync(process.env.PYTHON || 'python', [resolve('tests/fixtures/transporte_gtfs_fixture.py'), mode], { maxBuffer: 1000000, windowsHide: true })
  if (result.status !== 0) throw Error('No se pudo construir el GTFS de prueba')
  return new Uint8Array(result.stdout)
}
