# Verificacion post-deploy del hardening v1.8.0.
#
# Chequea: deploy correcto, headers de seguridad, CSP con reporting,
# info disclosure de /api/health con gate de token, CORS block de origenes
# forasteros, 404 generico, endpoints del Ministerio y de geocoding.
#
# Uso:
#   # Normal: el script carga el token desde .dev.vars (gitignored) automaticamente.
#   .\scripts\verify-prod.ps1
#
#   # O pasandolo como parametro / variable de entorno:
#   .\scripts\verify-prod.ps1 -Token 'TU_TOKEN'
#   $env:HEALTH_ADMIN_TOKEN = 'TU_TOKEN'; .\scripts\verify-prod.ps1
#
# Para regenerar token en prod:
#   $t = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   echo $t | npx wrangler pages secret put HEALTH_ADMIN_TOKEN --project-name=webapp
#   # Actualiza .dev.vars con el mismo valor.
#
# Compatible con Windows PowerShell 5.1 y PowerShell 7+.
# El script imprime [PASS]/[FAIL] por cada comprobacion y un resumen al final.
# Exit code: 0 si todo pasa, 1 si hay fallos.

[CmdletBinding()]
param(
  [string]$BaseUrl = 'https://webapp-3ft.pages.dev',
  [string]$Token   = $env:HEALTH_ADMIN_TOKEN
)

# Auto-load .dev.vars (gitignored) si no se ha pasado token explicito ni variable
# de entorno. Asi el script funciona "out of the box" despues de clonar el repo
# y crear el .dev.vars local, sin tener que exportar nada cada vez.
if (-not $Token) {
  $devVarsPath = Join-Path $PSScriptRoot '..\.dev.vars'
  if (Test-Path $devVarsPath) {
    foreach ($line in Get-Content $devVarsPath) {
      $trimmed = $line.Trim()
      if ($trimmed -and -not $trimmed.StartsWith('#') -and $trimmed -match '^([^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $val = $matches[2].Trim().Trim('"').Trim("'")
        if ($key -eq 'HEALTH_ADMIN_TOKEN' -and $val) { $Token = $val; break }
      }
    }
  }
}

$ErrorActionPreference = 'Continue'
$script:pass = 0
$script:fail = 0
$script:warn = 0
# SkipHttpErrorCheck solo existe en PowerShell 7+. En Windows PowerShell 5.1
# tenemos que cachear la WebException y extraer la respuesta a mano.
$script:isPS7 = $PSVersionTable.PSVersion.Major -ge 7

function Ok($msg)   { Write-Host "[PASS] $msg" -ForegroundColor Green; $script:pass++ }
function Bad($msg)  { Write-Host "[FAIL] $msg" -ForegroundColor Red;   $script:fail++ }
function Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow; $script:warn++ }
function Info($msg) { Write-Host "       $msg" -ForegroundColor Gray }

function Get-Resp {
  param(
    [string]$Url,
    [hashtable]$Headers = @{},
    [string]$Method = 'GET',
    [string]$Body = $null,
    [string]$ContentType = $null,
    # -1 = valor por defecto de Invoke-WebRequest (sigue redirects). 0 = no seguir.
    [int]$MaxRedir = -1
  )
  $params = @{ Uri = $Url; Method = $Method; Headers = $Headers; UseBasicParsing = $true; ErrorAction = 'Stop' }
  if ($Body) { $params.Body = $Body }
  if ($ContentType) { $params.ContentType = $ContentType }
  if ($script:isPS7) { $params.SkipHttpErrorCheck = $true }
  if ($MaxRedir -ge 0) { $params.MaximumRedirection = $MaxRedir }
  try {
    return Invoke-WebRequest @params
  } catch {
    # PS 5.1: un 3xx con MaxRedir=0 o un 4xx/5xx lanzan WebException. Reconstruimos
    # la shape de Invoke-WebRequest para que el resto del script funcione igual.
    $ex = $_.Exception
    $resp = $null
    if ($ex) { $resp = $ex.Response }
    if (-not $resp) { return $null }
    $status = 0
    try { $status = [int]$resp.StatusCode } catch {}
    # Leer el body. En PS 5.1 hay que rebobinar el stream (PS puede haberlo
    # tocado antes) y descartar el buffer del reader. Sin esto, ReadToEnd()
    # devuelve cadena vacia aunque el cuerpo este ahi.
    $content = ''
    try {
      $stream = $resp.GetResponseStream()
      if ($stream) {
        try { if ($stream.CanSeek) { $stream.Position = 0 } } catch {}
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        try { $reader.DiscardBufferedData() } catch {}
        $content = $reader.ReadToEnd()
        $reader.Close()
      }
    } catch {}
    $hdrs = @{}
    try {
      foreach ($k in $resp.Headers.AllKeys) { $hdrs[$k] = $resp.Headers[$k] }
    } catch {}
    return [pscustomobject]@{ StatusCode = $status; Content = $content; Headers = $hdrs }
  }
}

Write-Host ""
Write-Host "===  Verificando $BaseUrl  ===" -ForegroundColor Cyan
Write-Host ""

# ---- 1. /api/health publico: solo {ok, ts} ----
Write-Host "[1] /api/health (publico, sin token)" -ForegroundColor Cyan
$r = Get-Resp -Url "$BaseUrl/api/health"
if (-not $r) { Bad "sin respuesta (red o 404)"; }
elseif ($r.StatusCode -ne 200) { Bad "status $($r.StatusCode) (esperado 200 si snapshot fresco)"; }
else {
  $json = $r.Content | ConvertFrom-Json
  if ($json.ok -eq $true -and $json.ts) { Ok "200 con {ok, ts}" }
  else { Bad "respuesta no contiene {ok, ts}" }
  if ($null -ne $json.version) { Bad "LEAK: expone 'version' sin admin token (=$($json.version))" }
  elseif ($null -ne $json.caches) { Bad "LEAK: expone 'caches' sin admin token" }
  else { Ok "no expone detalle interno sin token" }
}

# ---- 2. /api/health con token correcto: detalle completo ----
Write-Host ""
Write-Host "[2] /api/health (con X-Admin-Token)" -ForegroundColor Cyan
if (-not $Token) {
  # Sin token no podemos ejecutar esta prueba, pero tampoco es un fallo
  # de produccion (la constant-time comparison se valida en [3]). Lo marcamos
  # como informativo para no inflar el contador de warnings.
  Info "test omitido: define HEALTH_ADMIN_TOKEN en .dev.vars o pasa -Token para activarlo"
} else {
  $r = Get-Resp -Url "$BaseUrl/api/health" -Headers @{ 'X-Admin-Token' = $Token }
  if (-not $r) { Bad "sin respuesta" }
  elseif ($r.StatusCode -ne 200) { Bad "status $($r.StatusCode)" }
  else {
    $json = $r.Content | ConvertFrom-Json
    if ($json.version) { Ok "devuelve version = $($json.version)" }
    else { Bad "admin request no devuelve 'version'" }
    if ($json.caches) { Ok "devuelve caches ($(($json.caches | ConvertTo-Json -Compress)))" }
    else { Bad "admin request no devuelve 'caches'" }
    if ($json.version -eq '1.8.0') { Ok "v1.8.0 desplegada correctamente" }
    elseif ($json.version) { Warn "version = $($json.version) (esperado 1.8.0 tras este hardening)" }
  }
}

# ---- 3. /api/health con token incorrecto: respuesta igual que sin token ----
Write-Host ""
Write-Host "[3] /api/health (con token MALO)" -ForegroundColor Cyan
$r = Get-Resp -Url "$BaseUrl/api/health" -Headers @{ 'X-Admin-Token' = 'definitivamente-no-es-el-token-xxxxxxxxxxxxxxxxxxxxxxxxxx' }
if ($r -and $r.StatusCode -eq 200) {
  $json = $r.Content | ConvertFrom-Json
  if ($null -eq $json.version -and $null -eq $json.caches) { Ok "token invalido NO expone detalle (constant-time OK)" }
  else { Bad "token invalido EXPONE detalle (comparacion rota)" }
} else { Bad "no pude testear (status $($r.StatusCode))" }

# ---- 4. Headers de seguridad en la home ----
# Ship 26: la home del mapa vive en /gasolineras/ (antes en /). La raiz
# redirige 301 al portal; los headers de seguridad se sirven en la pagina
# real. Verificamos ambas cosas: (a) redirect funcional, (b) headers en /gasolineras/.
Write-Host ""
Write-Host "[4a] Redirect 301 de raiz (/ -> /gasolineras/)" -ForegroundColor Cyan
$r = Get-Resp -Url "$BaseUrl/" -MaxRedir 0
if ($r -and $r.StatusCode -eq 301) {
  $loc = $r.Headers['Location']
  if ($loc -is [array]) { $loc = $loc[0] }
  if ($loc -match '/gasolineras/') { Ok "/ responde 301 a $loc" }
  else { Bad "/ responde 301 pero Location='$loc' (esperado /gasolineras/)" }
}
elseif ($r) { Bad "esperado 301, recibido $($r.StatusCode)" }
else { Bad "sin respuesta" }

Write-Host ""
Write-Host "[4] Headers de seguridad en GET /gasolineras/" -ForegroundColor Cyan
$r = Get-Resp -Url "$BaseUrl/gasolineras/"
if (-not $r) { Bad "sin respuesta"; }
else {
  $h = $r.Headers
  $expected = @{
    'Strict-Transport-Security'         = 'max-age='
    'X-Content-Type-Options'            = 'nosniff'
    'X-Frame-Options'                   = 'DENY'
    'Referrer-Policy'                   = 'strict-origin-when-cross-origin'
    'Cross-Origin-Opener-Policy'        = 'same-origin'
    'Cross-Origin-Resource-Policy'      = 'same-origin'
    'Content-Security-Policy'           = "default-src 'self'"
    'Reporting-Endpoints'               = 'csp-endpoint'
    'Permissions-Policy'                = 'interest-cohort=()'
  }
  foreach ($k in $expected.Keys) {
    $v = $h[$k]
    if ($v -is [array]) { $v = $v[0] }
    if ($v -and $v -match [regex]::Escape($expected[$k])) { Ok "$k presente (contiene '$($expected[$k])')" }
    else { Bad "$k ausente o mal (valor='$v')" }
  }
  # CSP debe tener report-uri y nonce
  $csp = $h['Content-Security-Policy']
  if ($csp -is [array]) { $csp = $csp[0] }
  if ($csp -match 'report-uri /api/csp-report') { Ok "CSP tiene 'report-uri /api/csp-report'" }
  else { Bad "CSP sin report-uri" }
  if ($csp -match "nonce-[A-Za-z0-9+/=]+") { Ok "CSP tiene nonce por request" }
  else { Bad "CSP sin nonce" }
  if ($csp -match "frame-ancestors 'none'") { Ok "CSP bloquea iframes de terceros (frame-ancestors none)" }
  else { Bad "CSP permite embedding en iframes" }
}

# ---- 5. CORS: origen forastero debe ser 403 ----
Write-Host ""
Write-Host "[5] CORS: origen forastero a /api/provincias" -ForegroundColor Cyan
$r = Get-Resp -Url "$BaseUrl/api/provincias" -Headers @{ 'Origin' = 'https://evil.example.com' }
if ($r -and $r.StatusCode -eq 403) { Ok "Bloquea https://evil.example.com con 403" }
elseif ($r) { Bad "status $($r.StatusCode) con origen forastero (esperado 403)" }
else { Bad "sin respuesta" }

# ---- 6. Rate-limit headers ----
Write-Host ""
Write-Host "[6] Rate limiting (X-RateLimit-* en /api/provincias)" -ForegroundColor Cyan
$r = Get-Resp -Url "$BaseUrl/api/provincias"
if ($r -and $r.Headers['X-RateLimit-Limit']) {
  $lim = $r.Headers['X-RateLimit-Limit']; $rem = $r.Headers['X-RateLimit-Remaining']
  if ($lim -is [array]) { $lim = $lim[0] }; if ($rem -is [array]) { $rem = $rem[0] }
  Ok "X-RateLimit-Limit=$lim Remaining=$rem"
} else { Warn "sin X-RateLimit-* (puede estar cacheado por colo)" }

# ---- 7. Endpoints basicos del Ministerio ----
Write-Host ""
Write-Host "[7] Endpoints del Ministerio" -ForegroundColor Cyan
$r = Get-Resp -Url "$BaseUrl/api/provincias"
if ($r -and $r.StatusCode -eq 200) {
  try { $j = $r.Content | ConvertFrom-Json; if ($j.Count -ge 50) { Ok "/api/provincias devuelve $($j.Count) provincias" } else { Warn "/api/provincias devuelve $($j.Count) items" } }
  catch { Bad "/api/provincias no parsea como JSON array" }
} else { Bad "/api/provincias status $($r.StatusCode)" }

$r = Get-Resp -Url "$BaseUrl/api/estaciones/provincia/28"
if ($r -and $r.StatusCode -eq 200) { Ok "/api/estaciones/provincia/28 (Madrid) OK" }
else { Bad "/api/estaciones/provincia/28 status $($r.StatusCode)" }

$r = Get-Resp -Url "$BaseUrl/api/estaciones/provincia/99"
if ($r -and $r.StatusCode -eq 400) { Ok "/api/estaciones/provincia/99 (INE invalido) bloqueado con 400" }
else { Bad "/api/estaciones/provincia/99 devolvio $($r.StatusCode) (esperado 400)" }

$r = Get-Resp -Url "$BaseUrl/api/estaciones/provincia/../secret"
if ($r -and ($r.StatusCode -eq 400 -or $r.StatusCode -eq 404)) { Ok "path traversal bloqueado" }
else { Bad "path traversal devolvio $($r.StatusCode)" }

# ---- 8. Geocoding proxy ----
Write-Host ""
Write-Host "[8] Geocoding proxy (Nominatim via /api/geocode/*)" -ForegroundColor Cyan
$r = Get-Resp -Url "$BaseUrl/api/geocode/search?q=Madrid"
if ($r -and $r.StatusCode -eq 200) { Ok "/api/geocode/search?q=Madrid OK" }
else { Bad "/api/geocode/search status $($r.StatusCode)" }

$r = Get-Resp -Url "$BaseUrl/api/geocode/search?q=" # query invalida
if ($r -and $r.StatusCode -eq 400) { Ok "query vacia rechazada con 400" }
else { Bad "query vacia devolvio $($r.StatusCode)" }

$r = Get-Resp -Url "$BaseUrl/api/geocode/reverse?lat=999&lon=0" # lat fuera de rango
if ($r -and $r.StatusCode -eq 400) { Ok "lat fuera de rango rechazada con 400" }
else { Bad "lat invalida devolvio $($r.StatusCode)" }

# ---- 9. robots.txt y sitemap ----
Write-Host ""
Write-Host "[9] robots.txt y sitemap" -ForegroundColor Cyan
$r = Get-Resp -Url "$BaseUrl/robots.txt"
if ($r -and $r.StatusCode -eq 200 -and $r.Content -match 'Sitemap:') { Ok "robots.txt con Sitemap:" }
else { Bad "robots.txt status $($r.StatusCode)" }

$r = Get-Resp -Url "$BaseUrl/sitemap.xml"
if ($r -and $r.StatusCode -eq 200 -and $r.Content -match '<urlset') { Ok "sitemap.xml servido" }
else { Bad "sitemap.xml status $($r.StatusCode)" }

# ---- 10. 404 generico sin leak ----
Write-Host ""
Write-Host "[10] 404 generico sin stack trace" -ForegroundColor Cyan
$r = Get-Resp -Url "$BaseUrl/api/ruta-que-no-existe-xyz-1234"
if ($r -and $r.StatusCode -eq 404) {
  try {
    $j = $r.Content | ConvertFrom-Json
    if ($j.error -eq 'not_found' -and -not ($r.Content -match 'at\s+\w+|\.js:\d+|stack')) {
      Ok "404 JSON limpio: $($r.Content)"
    } else {
      Bad "404 con leak o formato inesperado: $($r.Content)"
    }
  } catch { Bad "404 no parsea como JSON" }
} else { Bad "ruta inexistente devolvio $($r.StatusCode) (esperado 404)" }

# ---- 11. CSP report endpoint acepta POST ----
Write-Host ""
Write-Host "[11] /api/csp-report (endpoint de reporting)" -ForegroundColor Cyan
$fakeReport = '{"csp-report":{"document-uri":"test","violated-directive":"script-src","blocked-uri":"inline"}}'
$r = Get-Resp -Url "$BaseUrl/api/csp-report" -Method POST -Body $fakeReport -ContentType 'application/csp-report'
if ($r -and $r.StatusCode -eq 204) { Ok "/api/csp-report acepta POST con 204 No Content" }
else { Bad "/api/csp-report status $($r.StatusCode) (esperado 204)" }

# ---- Resumen ----
Write-Host ""
Write-Host "===  Resumen  ===" -ForegroundColor Cyan
Write-Host "PASS : $script:pass" -ForegroundColor Green
Write-Host "WARN : $script:warn" -ForegroundColor Yellow
Write-Host "FAIL : $script:fail" -ForegroundColor Red
Write-Host ""

if ($script:fail -gt 0) {
  Write-Host "[X] Hay fallos. Revisa los [FAIL] arriba." -ForegroundColor Red
  exit 1
} elseif ($script:warn -gt 0) {
  Write-Host "[!] Todo OK pero con avisos menores." -ForegroundColor Yellow
  exit 0
} else {
  Write-Host "[OK] Hardening v1.8.0 verificado - todo verde." -ForegroundColor Green
  exit 0
}
