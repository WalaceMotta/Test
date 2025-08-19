import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

const db = new Database('data.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','preparing','ready','delivered')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  notes TEXT,
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(item_id) REFERENCES menu_items(id)
);
`);

const getMenuCount = db.prepare('SELECT COUNT(*) as c FROM menu_items').get() as any;
if (getMenuCount.c === 0) {
  const insertMenu = db.prepare('INSERT INTO menu_items (id, name, description, price_cents) VALUES (?, ?, ?, ?)');
  const seed = [
    { name: 'Hambúrguer Clássico', description: 'Pão, carne 160g, queijo, alface, tomate e molho da casa', price: 2490 },
    { name: 'Cheeseburger Duplo', description: 'Dois smash 100g, queijo duplo e picles', price: 3290 },
    { name: 'Combo Burger + Fritas', description: 'Hambúrguer + batata frita média', price: 3990 },
    { name: 'Batata Frita Média', description: 'Porção crocante', price: 1490 },
    { name: 'Refrigerante Lata', description: '350 ml', price: 790 },
  ];
  const insert = db.transaction(() => {
    for (const s of seed) insertMenu.run(uuidv4(), s.name, s.description, s.price);
  });
  insert();
}

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

function generateOrderCode(): string {
  const code = Math.floor(100 + Math.random() * 900).toString();
  return code;
}

function emitQueueUpdate() {
  const pending = db.prepare("SELECT id, code, status, created_at FROM orders WHERE status IN ('pending','preparing') ORDER BY created_at ASC").all();
  const ready = db.prepare("SELECT id, code, status, created_at FROM orders WHERE status = 'ready' ORDER BY created_at ASC").all();
  io.emit('queue:update', { pending, ready });
}

app.get('/api/menu', (_req, res) => {
  const items = db.prepare('SELECT id, name, description, price_cents FROM menu_items').all();
  res.json(items);
});

app.post('/api/orders', (req, res) => {
  const { items, notes } = req.body as { items: Array<{ itemId: string; quantity: number }>; notes?: string };
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Itens inválidos' });

  const orderId = uuidv4();
  const code = generateOrderCode();
  const createdAt = Date.now();

  const insertOrder = db.prepare('INSERT INTO orders (id, code, status, created_at) VALUES (?, ?, ?, ?)');
  const insertOrderItem = db.prepare('INSERT INTO order_items (id, order_id, item_id, quantity, notes) VALUES (?, ?, ?, ?, ?)');

  const tx = db.transaction(() => {
    insertOrder.run(orderId, code, 'pending', createdAt);
    for (const it of items) {
      if (!it.itemId || typeof it.quantity !== 'number' || it.quantity <= 0) throw new Error('Item inválido');
      insertOrderItem.run(uuidv4(), orderId, it.itemId, it.quantity, notes ?? null);
    }
  });

  try {
    tx();
    emitQueueUpdate();
    res.status(201).json({ orderId, code });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Erro ao criar pedido' });
  }
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.prepare('SELECT id, code, status, created_at FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  const items = db.prepare(`
    SELECT mi.name, mi.price_cents, oi.quantity, oi.notes
    FROM order_items oi JOIN menu_items mi ON mi.id = oi.item_id
    WHERE oi.order_id = ?
  `).all(req.params.id);
  res.json({ ...order, items });
});

app.get('/api/kitchen/queue', (_req, res) => {
  const pending = db.prepare("SELECT id, code, status, created_at FROM orders WHERE status IN ('pending','preparing') ORDER BY created_at ASC").all();
  const ready = db.prepare("SELECT id, code, status, created_at FROM orders WHERE status = 'ready' ORDER BY created_at ASC").all();
  res.json({ pending, ready });
});

app.post('/api/kitchen/:id/status', (req, res) => {
  const { status } = req.body as { status: 'pending' | 'preparing' | 'ready' | 'delivered' };
  const valid = ['pending','preparing','ready','delivered'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Status inválido' });
  const info = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
  emitQueueUpdate();
  res.json({ ok: true });
});

io.on('connection', () => {
  emitQueueUpdate();
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;
httpServer.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));

