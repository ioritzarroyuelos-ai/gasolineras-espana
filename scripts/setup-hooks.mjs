// Configuración local de hooks, compatible con Windows, macOS y Linux.
import { execFileSync } from 'node:child_process'
try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
} catch {
  // Instalar dependencias fuera de un checkout también debe funcionar.
  console.log('No se configuraron hooks locales de Git.')
}
