import WebSocket from 'ws'
import { EventEmitter } from 'events'

const DEFAULT_PORT = 9720
const RECONNECT_DELAY = 3000

export class WsClient extends EventEmitter {
  private ws: WebSocket | null = null
  private url: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionallyClosed = false

  constructor() {
    super()
    const port = process.env.ISLAND_WS_PORT
      ? parseInt(process.env.ISLAND_WS_PORT, 10)
      : DEFAULT_PORT
    this.url = `ws://localhost:${port}`
  }

  connect(): void {
    this.intentionallyClosed = false
    this.tryConnect()
  }

  private tryConnect(): void {
    if (this.intentionallyClosed) return
    try {
      this.ws = new WebSocket(this.url)
      this.ws.on('open', () => {
        this.emit('connected')
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
      })
      this.ws.on('message', (data) => {
        try { this.emit('message', JSON.parse(data.toString())) } catch { /* ignore */ }
      })
      this.ws.on('close', () => {
        this.emit('disconnected')
        this.scheduleReconnect()
      })
      this.ws.on('error', () => { /* close event handles reconnect */ })
    } catch {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.tryConnect()
    }, RECONNECT_DELAY)
  }

  send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  close(): void {
    this.intentionallyClosed = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.ws?.close()
    this.ws = null
  }
}
