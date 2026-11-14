#!/usr/bin/env node
// Muestra el tope por IP de WAF en vivo: pide la página pública de una cola muchas veces seguidas y
// cuenta cuántos pedidos pasan (200) y cuántos bloquea WAF (403) antes de que lleguen a la Lambda.
//
//   node scripts/demo-waf.mjs <url de la cola de demo> [pedidos]
//
// La URL es la de `demo_queue_url` (…/prod/q/?id=<cola>). WAF evalúa el tope por ventanas de un minuto
// y tarda unos segundos en empezar a bloquear: conviene mandar bastante más que el tope (300 por
// defecto). Después de un par de minutos sin pedidos, la IP vuelve a pasar.

const [, , queueUrl, total = '600'] = process.argv
if (!queueUrl) {
  console.error('Uso: node scripts/demo-waf.mjs <url de la cola de demo> [pedidos]')
  process.exit(2)
}

const url = new URL(queueUrl)
const queueId = url.searchParams.get('id')
if (!queueId) {
  console.error('La URL tiene que ser la de una cola: …/q/?id=<cola>')
  process.exit(2)
}
const stage = url.pathname.split('/')[1]
const target = `${url.origin}/${stage}/api/v1/public/queues/${queueId}`

const counts = new Map()
let firstBlocked = null
const started = Date.now()
const CONCURRENCY = 20
let sent = 0

async function worker() {
  while (sent < Number(total)) {
    const n = ++sent
    let status
    try {
      status = (await fetch(target)).status
    } catch {
      status = 'error'
    }
    counts.set(status, (counts.get(status) ?? 0) + 1)
    if (status === 403 && firstBlocked === null) firstBlocked = n
    if (n % 50 === 0) {
      const summary = [...counts].map(([code, count]) => `${code}: ${count}`).join('  ')
      console.log(`${String(n).padStart(4)} pedidos · ${summary}`)
    }
  }
}

console.log(`Pidiendo ${total} veces ${target}\n`)
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(`\nListo en ${seconds} s.`)
for (const [code, count] of counts) console.log(`  ${code}: ${count}`)
console.log(
  firstBlocked === null
    ? '\nWAF no bloqueó: mandá más pedidos, o bajá el tope (var.waf_public_rate_limit).'
    : `\nWAF empezó a bloquear en el pedido ${firstBlocked}. Los bloqueados se ven en la consola de WAF,`
      + ' en la regla "tope-rutas-publicas".',
)
