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
    const [f, g, s, t, tr, pr] = await Promise.all([
      db.execute('SELECT * FROM facturas'),
      db.execute('SELECT * FROM granel'),
      db.execute('SELECT * FROM salidas ORDER BY id DESC'),
      db.execute('SELECT * FROM transito'),
      db.execute('SELECT * FROM traslados ORDER BY id DESC'),
      db.execute('SELECT * FROM programados ORDER BY fecha ASC'),
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
      ...(r.proveedor ? { proveedor: r.proveedor } : {}),
      ...(r.fecha_pedido ? { fechaPedido: r.fecha_pedido } : {}),
    }));
    const traslados = tr.rows.map(r => ({
      id: r.id, origen: r.origen, destino: r.destino, mat: r.mat,
      cant: r.cant, fecha: r.fecha, nota: r.nota, usuario: r.usuario,
    }));
    const programados = pr.rows.map(r => ({
      id: r.id, camion: r.camion, plant: r.plant, fecha: r.fecha,
      productos: JSON.parse(r.productos || '[]'), notas: r.notas,
    }));
    const rol = req.user.rol;
    const plantFilter = rol === 'viewer_deg' ? 'degollado' : rol === 'viewer_emb' ? 'embajador' : null;
    if (plantFilter) {
      return res.json({
        facturas: facturas.filter(f => f.plant === plantFilter),
        granel: granel.filter(g => g.planta === plantFilter),
        salidas: salidas.filter(s => s.plant === plantFilter),
        transito: transito.filter(t => t.plant === plantFilter),
        traslados: traslados.filter(t => t.origen === plantFilter || t.destino === plantFilter),
        programados: programados.filter(p => p.plant === plantFilter),
      });
    }
    res.json({ facturas, granel, salidas, transito, traslados, programados });
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

// ── EDITAR FACTURA ─────────────────────────────────────
app.put('/api/factura/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { num, prov, fecha, cantIni, cantRest, nom } = req.body;
    await db.execute({
      sql: `UPDATE facturas SET num=?,prov=?,fecha=?,cant_ini=?,cant_rest=?,nom=? WHERE id=?`,
      args: [num, prov||'', fecha, cantIni, cantRest, nom||null, id],
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error actualizando factura' });
  }
});

// ── ELIMINAR FACTURA ───────────────────────────────────
app.delete('/api/factura/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await db.execute({ sql: 'DELETE FROM facturas WHERE id=?', args: [id] });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error eliminando factura' });
  }
});

// ── REGISTRAR MATERIAL SOLICITADO ──────────────────────
app.post('/api/transito', auth, adminOnly, async (req, res) => {
  try {
    const { id, plant, mat, cant, nom, proveedor, fechaPedido } = req.body;
    await db.execute({
      sql: `INSERT INTO transito (id, plant, mat, cant, nom, proveedor, fecha_pedido) VALUES (?,?,?,?,?,?,?)`,
      args: [String(id || Date.now()), plant, mat, cant, nom || null, proveedor || null, fechaPedido || null],
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error registrando solicitud' });
  }
});

// ── ELIMINAR MATERIAL SOLICITADO ───────────────────────
app.delete('/api/transito/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM transito WHERE id=?', args: [req.params.id] });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error eliminando solicitud' });
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
      // crear factura (ingreso) con la cantidad que llegó y el proveedor del pedido
      stmts.push({
        sql: `INSERT INTO facturas (id,num,prov,plant,mat,cant_ini,cant_rest,fecha,nom)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [String(b + i), 'LLEGADA-SOLICITUD', t.proveedor || 'Entrega recibida', plant, mat, t.cant, t.cant, new Date().toISOString().split('T')[0], t.nom || null],
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

// ── EMBARQUES PROGRAMADOS ──────────────────────────────
app.get('/api/programados', auth, async (req, res) => {
  try {
    const r = await db.execute('SELECT * FROM programados ORDER BY fecha ASC');
    res.json(r.rows.map(row => ({
      id: row.id, camion: row.camion, plant: row.plant, fecha: row.fecha,
      productos: JSON.parse(row.productos || '[]'), notas: row.notas,
    })));
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/programados', auth, adminOnly, async (req, res) => {
  try {
    const { id, camion, plant, fecha, productos, notas } = req.body;
    await db.execute({
      sql: `INSERT INTO programados (id,camion,plant,fecha,productos,notas) VALUES (?,?,?,?,?,?)`,
      args: [String(id||Date.now()), camion, plant, fecha, JSON.stringify(productos||[]), notas||null],
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/programados/:id', auth, adminOnly, async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM programados WHERE id=?', args: [req.params.id] });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// ── REGISTRAR TRASLADO ─────────────────────────────────
app.post('/api/traslado', auth, adminOnly, async (req, res) => {
  try {
    const { id, origen, destino, mat, cant, fecha, nota, usuario } = req.body;
    if (!origen || !destino || !mat || !cant) return res.status(400).json({ error: 'Faltan datos' });
    if (origen === destino) return res.status(400).json({ error: 'Origen y destino iguales' });

    // Obtener facturas disponibles en origen ordenadas por menor stock primero (FIFO)
    const fOrigen = await db.execute({
      sql: `SELECT id, cant_rest FROM facturas WHERE plant=? AND mat=? AND cant_rest>0 ORDER BY cant_rest ASC`,
      args: [origen, mat],
    });
    const totalDisp = fOrigen.rows.reduce((s, r) => s + r.cant_rest, 0);
    if (totalDisp < cant) return res.status(400).json({ error: `Stock insuficiente (disponible: ${totalDisp})` });

    const stmts = [];
    // Descontar del origen (FIFO)
    let restante = cant;
    for (const row of fOrigen.rows) {
      if (restante <= 0) break;
      const usar = Math.min(row.cant_rest, restante);
      stmts.push({ sql: 'UPDATE facturas SET cant_rest=cant_rest-? WHERE id=?', args: [usar, row.id] });
      restante -= usar;
    }
    // Crear factura en destino
    const newId = String(id || Date.now());
    const numOrigen = origen.toUpperCase().slice(0, 3);
    stmts.push({
      sql: `INSERT INTO facturas (id,num,prov,plant,mat,cant_ini,cant_rest,fecha) VALUES (?,?,?,?,?,?,?,?)`,
      args: [newId, `TRASLADO-${numOrigen}`, `Traslado desde ${origen}`, destino, mat, cant, cant, fecha],
    });
    // Guardar registro en tabla traslados
    stmts.push({
      sql: `INSERT INTO traslados (id,origen,destino,mat,cant,fecha,nota,usuario) VALUES (?,?,?,?,?,?,?,?)`,
      args: [newId, origen, destino, mat, cant, fecha, nota || null, usuario || 'admin'],
    });
    await db.batch(stmts, 'write');
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error registrando traslado' });
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
