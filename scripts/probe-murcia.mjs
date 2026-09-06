#!/usr/bin/env node
// probe-murcia.mjs — SONDEO TEMPORAL (no escribe datos, no despliega).
//
// Objetivo: averiguar a que hora del dia responde bien la API del COF Region de
// Murcia (https://guardias.cofrm.com/api/pharmacies), que ultimamente devuelve
// 500/504 en el pase diario. Lo lanza .github/workflows/probe-murcia.yml cada
// hora durante un dia; luego se leen los logs para elegir la mejor franja y se
// retira este sondeo + su workflow.
//
// Hace hasta 3 intentos rapidos (10s entre ellos) para distinguir "caido del
// todo" de "intermitente", e imprime UNA linea grep-able por ejecucion:
//   PROBE-MURCIA <iso-utc> result=OK|FAIL intentos=[200,200,200] ms=<primerOK> total=<n> guardia=<n>
// Nunca sale con codigo !=0 (es un sondeo, no debe marcar el run en rojo).

const API_URL = 'https://guardias.cofrm.com/api/pharmacies'
const USER_AGENT = 'cercaya-probe-murcia/1.0 (+https://webapp-3ft.pages.dev)'
const INTENTOS = 3
const ESPERA_MS = 10000

async function unIntento() {
  const t0 = Date.now()
  try {
    const res = await fetch(API_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    })
    const ms = Date.now() - t0
    if (!res.ok) return { ok: false, code: res.status, ms }
    let total = null
    let guardia = null
    try {
      const data = await res.json()
      if (Array.isArray(data)) {
        total = data.length
        guardia = data.filter(p => p && p.isOnCallRotation === true).length
      }
    } catch { /* respuesta no-JSON: la contamos como OK de red pero sin datos */ }
    return { ok: true, code: res.status, ms, total, guardia }
  } catch (e) {
    return { ok: false, code: 'ERR:' + String(e.message || e).slice(0, 40), ms: Date.now() - t0 }
  }
}

async function main() {
  const iso = new Date().toISOString()
  const intentos = []
  let primerOk = null
  for (let i = 1; i <= INTENTOS; i++) {
    const r = await unIntento()
    intentos.push(r)
    if (r.ok && !primerOk) primerOk = r
    if (r.ok) break // con un OK ya nos vale
    if (i < INTENTOS) await new Promise(res => setTimeout(res, ESPERA_MS))
  }
  const ok = intentos.some(r => r.ok)
  const codes = intentos.map(r => r.code).join(',')
  const ms = primerOk ? primerOk.ms : (intentos[0] ? intentos[0].ms : 0)
  const total = primerOk ? primerOk.total : ''
  const guardia = primerOk ? primerOk.guardia : ''
  console.log(
    `PROBE-MURCIA ${iso} result=${ok ? 'OK' : 'FAIL'} intentos=[${codes}] ms=${ms} total=${total} guardia=${guardia}`
  )
}

main().catch(e => {
  console.log(`PROBE-MURCIA ${new Date().toISOString()} result=FAIL intentos=[SCRIPT-ERR:${String(e.message || e).slice(0, 60)}]`)
  process.exit(0)
})
