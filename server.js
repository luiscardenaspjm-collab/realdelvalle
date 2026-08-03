// ═══════════════════════════════════════════════════════
//  Real del Valle · Servidor (Express + Turso + JWT)
// ═══════════════════════════════════════════════════════
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esta-clave-en-railway';

// ── Cliente Turso ──────────────────────────────────────
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Middleware de autenticación ────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// Solo administradores pueden escribir
function adminOnly(req, res, next) {
  if (req.user && req.user.rol === 'admin') return next();
  return res.status(403).json({ error: 'No tienes permiso para realizar esta acción' });
}

// ── LOGIN ──────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan datos' });
    const r = await db.execute({
      sql: 'SELECT * FROM usuarios WHERE username = ?',
      args: [username.trim().toLowerCase()],
    });
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const rol = user.rol || 'admin';
    const token = jwt.sign({ uid: user.id, username: user.username, rol }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, rol });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── OBTENER TODA LA DATA ───────────────────────────────
app.get('/api/data', auth, async (req, res) => {
  try {
    const [f, g, s, t] = await Promise.all([
      db.execute('SELECT * FROM facturas'),
      db.execute('SELECT * FROM granel'),
      db.execute('SELECT * FROM salidas ORDER BY id DESC'),
      db.execute('SELECT * FROM transito'),
    ]);
    const facturas = f.rows.map(r => ({
      id: r.id, num: r.num, prov: r.prov, plant: r.plant, mat: r.mat,
      cantIni: r.cant_ini, cantRest: r.cant_rest, fecha: r.fecha,
      ...(r.nom ? { nom: r.nom } : {}),
      ...(r.baseline ? { baseline: true } : {}),
    }));
    const granel = g.rows.map(r => ({
      id: r.id, pasaporte: r.pasaporte, analisis: r.analisis, lote: r.lote,
      planta: r.planta, tipo: r.tipo, litros: r.litros, litrosRest: r.litros_rest,
      fecha: r.fecha, notas: r.notas,
    }));
    const salidas = s.rows.map(r => ({
      id: r.id, camion: r.camion, plant: r.plant, fecha: r.fecha,
      productos: JSON.parse(r.productos || '[]'),
      consumos: JSON.parse(r.consumos || '[]'),
      consumosGranel: JSON.parse(r.consumos_granel || '[]'),
    }));
    const transito = t.rows.map(r => ({
      id: r.id, plant: r.plant, mat: r.mat, cant: r.cant,
      ...(r.nom ? { nom: r.nom } : {}),
    }));
    res.json({ facturas, granel, salidas, transito });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error leyendo datos' });
  }
});

// ── REGISTRAR FACTURA (ingreso de material) ────────────
app.post('/api/factura', auth, adminOnly, async (req, res) => {
  try {
    const f = req.body;
    await db.execute({
      sql: `INSERT INTO facturas (id,num,prov,plant,mat,cant_ini,cant_rest,fecha,nom,baseline)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [String(f.id), f.num, f.prov || '', f.plant, f.mat, f.cantIni, f.cantRest, f.fecha, f.nom || null, f.baseline ? 1 : 0],
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error guardando factura' });
  }
});

// ── MARCAR LLEGADA DE TRÁNSITO ─────────────────────────
app.post('/api/llegada', auth, adminOnly, async (req, res) => {
  try {
    const { plant, mat } = req.body;
    if (!plant || !mat) return res.status(400).json({ error: 'Faltan datos' });
    // Buscar entradas en tránsito de ese material/planta
    const r = await db.execute({
      sql: 'SELECT * FROM transito WHERE plant = ? AND mat = ?',
      args: [plant, mat],
    });
    if (!r.rows.length) return res.status(404).json({ error: 'Nada en tránsito' });
    const stmts = [];
    const b = Date.now();
    r.rows.forEach((t, i) => {
      // crear factura (ingreso) con la cantidad que llegó
      stmts.push({
        sql: `INSERT INTO facturas (id,num,prov,plant,mat,cant_ini,cant_rest,fecha,nom)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [String(b + i), 'LLEGADA-TRANSITO', 'Entrega recibida', plant, mat, t.cant, t.cant, new Date().toISOString().split('T')[0], t.nom || null],
      });
    });
    // eliminar de tránsito
    stmts.push({ sql: 'DELETE FROM transito WHERE plant = ? AND mat = ?', args: [plant, mat] });
    await db.batch(stmts, 'write');
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error registrando llegada' });
  }
});

// ── REGISTRAR GRANEL ───────────────────────────────────
app.post('/api/granel', auth, adminOnly, async (req, res) => {
  try {
    const g = req.body;
    await db.execute({
      sql: `INSERT INTO granel (id,pasaporte,analisis,lote,planta,tipo,litros,litros_rest,fecha,notas)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [String(g.id), g.pasaporte, g.analisis, g.lote, g.planta, g.tipo, g.litros, g.litrosRest, g.fecha, g.notas || ''],
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error guardando granel' });
  }
});

// ── REGISTRAR SALIDA (descuenta facturas y granel) ─────
app.post('/api/salida', auth, adminOnly, async (req, res) => {
  try {
    const s = req.body;
    const stmts = [];
    // Insertar salida
    stmts.push({
      sql: `INSERT INTO salidas (id,camion,plant,fecha,productos,consumos,consumos_granel)
            VALUES (?,?,?,?,?,?,?)`,
      args: [String(s.id), s.camion, s.plant, s.fecha,
        JSON.stringify(s.productos || []),
        JSON.stringify(s.consumos || []),
        JSON.stringify(s.consumosGranel || [])],
    });
    // Descontar de facturas
    (s.consumos || []).forEach(c => {
      stmts.push({
        sql: `UPDATE facturas SET cant_rest = MAX(0, cant_rest - ?) WHERE id = ?`,
        args: [c.cant, String(c.fid)],
      });
    });
    // Descontar de granel
    (s.consumosGranel || []).forEach(c => {
      stmts.push({
        sql: `UPDATE granel SET litros_rest = MAX(0, litros_rest - ?) WHERE id = ?`,
        args: [c.litros, String(c.gId)],
      });
    });
    await db.batch(stmts, 'write');
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error guardando salida' });
  }
});

// ── Fallback al index ──────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Real del Valle corriendo en puerto ${PORT}`));
