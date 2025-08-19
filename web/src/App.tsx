import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { io, Socket } from 'socket.io-client'

type MenuItem = { id: string; name: string; description?: string; price_cents: number }
type OrderRef = { id: string; code: string; status: 'pending'|'preparing'|'ready'|'delivered'; created_at: number }

function centsToBRL(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function ClientPage() {
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [order, setOrder] = useState<{ orderId: string; code: string } | null>(null)

  useEffect(() => {
    fetch('/api/menu').then(r => r.json()).then(setMenu)
  }, [])

  const total = useMemo(() => Object.entries(cart).reduce((sum, [id, qty]) => {
    const item = menu.find(m => m.id === id)
    return sum + (item ? item.price_cents * qty : 0)
  }, 0), [cart, menu])

  function updateQty(id: string, delta: number) {
    setCart(c => {
      const next = { ...c }
      const q = (next[id] || 0) + delta
      if (q <= 0) delete next[id]; else next[id] = q
      return next
    })
  }

  async function placeOrder() {
    const items = Object.entries(cart).map(([itemId, quantity]) => ({ itemId, quantity }))
    if (items.length === 0) return
    const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, notes }) })
    const data = await res.json()
    if (res.ok) { setOrder(data); setCart({}); setNotes('') }
    else alert(data.error || 'Erro ao criar pedido')
  }

  return (
    <div className="page">
      <h1>Hamburgueria - Fazer Pedido</h1>
      <div className="menu">
        {menu.map(m => (
          <div key={m.id} className="card">
            <div className="title">{m.name}</div>
            <div className="desc">{m.description}</div>
            <div className="price">{centsToBRL(m.price_cents)}</div>
            <div className="actions">
              <button onClick={() => updateQty(m.id, -1)}>-</button>
              <span>{cart[m.id] || 0}</span>
              <button onClick={() => updateQty(m.id, 1)}>+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="notes">
        <label>Observações:</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex: sem cebola" />
      </div>

      <div className="footer">
        <div>Total: <strong>{centsToBRL(total)}</strong></div>
        <button disabled={total === 0} onClick={placeOrder}>Pagar e Enviar</button>
      </div>

      {order && (
        <div className="order-info">
          <h2>Pedido criado!</h2>
          <p>Sua senha: <strong>{order.code}</strong></p>
          <p>Acompanhe o painel: quando a senha for chamada, retire no balcão.</p>
        </div>
      )}
    </div>
  )
}

function KitchenPage() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [pending, setPending] = useState<OrderRef[]>([])
  const [ready, setReady] = useState<OrderRef[]>([])

  useEffect(() => {
    fetch('/api/kitchen/queue').then(r => r.json()).then(({ pending, ready }) => { setPending(pending); setReady(ready) })
    const s = io('/', { path: '/socket.io' })
    s.on('queue:update', ({ pending, ready }) => { setPending(pending); setReady(ready) })
    setSocket(s)
    return () => { s.close() }
  }, [])

  async function setStatus(id: string, status: OrderRef['status']) {
    await fetch(`/api/kitchen/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
  }

  return (
    <div className="page">
      <h1>Cozinha - Fila de Pedidos</h1>
      <div className="columns">
        <div>
          <h2>Em preparação</h2>
          <div className="list">
            {pending.map(o => (
              <div key={o.id} className="order">
                <div>Senha <strong>{o.code}</strong> — {new Date(o.created_at).toLocaleTimeString()}</div>
                <div className="buttons">
                  {o.status === 'pending' && <button onClick={() => setStatus(o.id, 'preparing')}>Iniciar</button>}
                  {o.status !== 'ready' && <button onClick={() => setStatus(o.id, 'ready')}>Pronto</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2>Prontos para retirada</h2>
          <div className="list">
            {ready.map(o => (
              <div key={o.id} className="order ready">
                <div>Senha <strong>{o.code}</strong></div>
                <div className="buttons">
                  <button onClick={() => setStatus(o.id, 'delivered')}>Entregue</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [view, setView] = useState<'cliente' | 'cozinha'>('cliente')
  return (
    <div>
      <div className="topbar">
        <button className={view==='cliente' ? 'active' : ''} onClick={() => setView('cliente')}>Cliente</button>
        <button className={view==='cozinha' ? 'active' : ''} onClick={() => setView('cozinha')}>Cozinha</button>
      </div>
      {view === 'cliente' ? <ClientPage /> : <KitchenPage />}
    </div>
  )
}

export default App
