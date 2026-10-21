// Prueba de humo del tiempo real, de punta a punta en AWS:
//
//   WebSocket abierto con el ticket ─▶ DELETE del ticket (REST) ─▶ stream de q-main ─▶ SNS FIFO
//   ─▶ SQS FIFO q-push ─▶ λ broadcaster ─▶ el mismo WebSocket recibe su ticket como LEFT
//
// Uso: node smoke-realtime.mjs <websocket_url> <ticket_token> <api_base>
// Termina con 0 si el aviso llega a tiempo, y con 1 si no.

const [websocketUrl, ticketToken, apiBase] = process.argv.slice(2)
if (!websocketUrl || !ticketToken || !apiBase) {
  console.error('Uso: node smoke-realtime.mjs <websocket_url> <ticket_token> <api_base>')
  process.exit(2)
}

const TIMEOUT_MS = 45_000
// El índice de conexiones es eventualmente consistente: unos segundos antes de provocar el evento.
const SETTLE_MS = 3_000

const fail = (message) => {
  console.error(message)
  process.exit(1)
}

const timer = setTimeout(() => fail(`No llegó el aviso por WebSocket en ${TIMEOUT_MS / 1000} s`), TIMEOUT_MS)
const socket = new WebSocket(`${websocketUrl}?ticket=${encodeURIComponent(ticketToken)}`)

socket.addEventListener('error', () => fail('No se pudo abrir el WebSocket'))
socket.addEventListener('open', () => {
  console.log('WebSocket abierto')
  setTimeout(async () => {
    const response = await fetch(`${apiBase}/public/tickets/${encodeURIComponent(ticketToken)}`, { method: 'DELETE' })
    if (!response.ok) fail(`Dejar la cola respondió ${response.status}`)
    console.log('Ticket liberado; esperando el aviso…')
  }, SETTLE_MS)
})
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.type === 'ticket.updated' && message.data?.status === 'LEFT') {
    console.log('Aviso recibido: el ticket figura como LEFT')
    clearTimeout(timer)
    socket.close()
    process.exit(0)
  }
})
