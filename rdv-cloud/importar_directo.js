// ═══════════════════════════════════════════════════════
//  importar_directo.js
//  Crea tablas, usuario admin y carga el inventario inicial
//  directamente en Turso (sin pasar por Railway).
//  Uso:  node importar_directo.js
// ═══════════════════════════════════════════════════════
const bcrypt = require('bcryptjs');
const { createClient } = require('@libsql/client');

// Lee de variables de entorno; si corres local crea un .env o exporta:
//   export TURSO_DATABASE_URL="libsql://..."
//   export TURSO_AUTH_TOKEN="..."
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ── Usuarios del sistema se definen abajo en main() ────

// ── Inventario inicial 10-Jun-2026 ─────────────────────
// [planta, material, cantidad, nom(opcional)]
const SEED = [
  // CUERMARO (actualizado 22-Jul-2026)
  ['cuermaro','bot_1750',    264, null],
  ['cuermaro','bot_1l',    42185, null],
  ['cuermaro','bot_750',    9360, null],
  ['cuermaro','bot_700',    1175, null],
  ['cuermaro','bot_375',    4298, null],
  ['cuermaro','etiq_1b',   54000, 'EMB'],
  ['cuermaro','etiq_1b',   39000, 'PB'],
  ['cuermaro','etiq_34b',   1000, 'DEG'],
  ['cuermaro','etiq_34b',    500, 'PB'],
  ['cuermaro','etiq_1750b', 1500, 'PB'],
  ['cuermaro','etiq_375b',   900, 'PB'],
  ['cuermaro','tapa_n',    42500, null],
  ['cuermaro','corcho_750', 8500, null],
  ['cuermaro','caja_b',     2619, null],
  ['cuermaro','caja_750b',   750, null],
  ['cuermaro','caja_750r',    75, null],
  ['cuermaro','separador',  3444, null],
  ['cuermaro','cb_gen',     4500, null],
  ['cuermaro','cinta_b',     130, null],
  ['cuermaro','cinta_transp', 32, null],
  // DEGOLLADO (actualizado)
  ['degollado','bot_1l',    41960, null],
  ['degollado','bot_750',    6825, null],
  ['degollado','etiq_1b',    8160, 'DEG'],
  ['degollado','etiq_1r',    1010, 'DEG'],
  ['degollado','etiq_34b',   7674, 'DEG'],
  ['degollado','etiq_34r',   6610, 'DEG'],
  ['degollado','etiq_bf1',   2838, 'DEG'],
  ['degollado','tapa_n',    18200, null],
  ['degollado','corcho_750',  139, null],
  ['degollado','caja_b',     3770, null],
  ['degollado','caja_750b',    88, null],
  ['degollado','caja_750r',   154, null],
  ['degollado','separador',  2060, null],
  ['degollado','cb_34b',     1268, null],
  ['degollado','cinta_b',      51, null],
  ['degollado','cinta_bf',     33, null],
  // ARANDAS / PB
  ['arandas','bot_1l',     36400, null],
  ['arandas','bot_750',     9370, null],
  ['arandas','etiq_1r',     6470, 'PB'],
  ['arandas','etiq_34r',    2880, 'PB'],
  ['arandas','tapa_n',     18000, null],
  ['arandas','corcho_750',  1000, null],
  ['arandas','caja_b',       600, null],
  ['arandas','caja_750r',    300, null],
  ['arandas','separador',    900, null],
  ['arandas','cb_1lr',      3000, null],
  ['arandas','cb_34r',      4500, null],
];

// Todos los materiales del catálogo (para bodega Embajador en ceros)
const MAT_IDS = ['bot_1l','bot_750','bot_700','bot_375','bot_1750',
  'etiq_1b','etiq_34b','etiq_1r','etiq_34r','etiq_1750b','etiq_1750r','etiq_375b','etiq_bf1',
  'tapa_n','corcho_750','corcho_700','corcho_1750','caja_b','caja_750b','caja_750r','separador',
  'cb_1lb','cb_34b','cb_1lr','cb_34r','cb_1750b','cb_gen','cinta_b','cinta_bf','cinta_transp'];

// En tránsito (por entregar) · [planta, material, cantidad, nom]
const TRANSITO = [
  ['degollado','etiq_1b',    42000, 'DEG'],
  ['degollado','etiq_1750b',  3950, 'DEG'],
  ['degollado','tapa_n',     75000, null],
  ['degollado','corcho_1750', 6000, null],
  ['degollado','etiq_1r',    41000, 'DEG'],
  ['degollado','bot_750',     6650, null],
  ['degollado','bot_1750',    2880, null],
];

async function main() {
  console.log('→ Creando tablas...');
  // Ejecutar statements UNO POR UNO (Turso no acepta bulk con punto y coma)
  await db.execute(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'admin'
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS facturas (
    id TEXT PRIMARY KEY,
    num TEXT NOT NULL,
    prov TEXT,
    plant TEXT NOT NULL,
    mat TEXT NOT NULL,
    cant_ini REAL NOT NULL,
    cant_rest REAL NOT NULL,
    fecha TEXT NOT NULL,
    nom TEXT,
    baseline INTEGER DEFAULT 0
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS granel (
    id TEXT PRIMARY KEY,
    pasaporte TEXT,
    analisis TEXT,
    lote TEXT NOT NULL,
    planta TEXT NOT NULL,
    tipo TEXT NOT NULL,
    litros REAL NOT NULL,
    litros_rest REAL NOT NULL,
    fecha TEXT NOT NULL,
    notas TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS salidas (
    id TEXT PRIMARY KEY,
    camion TEXT NOT NULL,
    plant TEXT NOT NULL,
    fecha TEXT NOT NULL,
    productos TEXT NOT NULL,
    consumos TEXT NOT NULL,
    consumos_granel TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS traslados (
    id TEXT PRIMARY KEY,
    origen TEXT NOT NULL,
    destino TEXT NOT NULL,
    mat TEXT NOT NULL,
    cant REAL NOT NULL,
    fecha TEXT NOT NULL,
    nota TEXT,
    usuario TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS transito (
    id TEXT PRIMARY KEY,
    plant TEXT NOT NULL,
    mat TEXT NOT NULL,
    cant REAL NOT NULL,
    nom TEXT
  )`);

  // ── Usuarios ──
  // [username, password, rol]   rol: 'admin' (ve y edita) | 'viewer' (solo ve)
  const USUARIOS = [
    ['Luisrdv',     'Control123',   'admin'],
    ['Eduardordv',  'Direccion123', 'viewer'],
  ];
  console.log('→ Creando usuarios...');
  for (const [username, pass, rol] of USUARIOS) {
    const hash = await bcrypt.hash(pass, 10);
    await db.execute({
      sql: `INSERT INTO usuarios (username, password_hash, rol) VALUES (?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, rol = excluded.rol`,
      args: [username.toLowerCase(), hash, rol],
    });
    console.log(`   ✓ ${username} (${rol})`);
  }

  // ── Inventario inicial ──
  // Solo carga si la tabla facturas está vacía (evita duplicados)
  const count = await db.execute('SELECT COUNT(*) AS n FROM facturas');
  if (count.rows[0].n > 0) {
    console.log(`⚠ Ya hay ${count.rows[0].n} facturas. No se vuelve a cargar el inventario inicial.`);
  } else {
    console.log('→ Cargando inventario inicial...');
    const base = Date.now();
    let i = 0;
    for (const [plant, mat, qty, nom] of SEED) {
      await db.execute({
        sql: `INSERT INTO facturas (id,num,prov,plant,mat,cant_ini,cant_rest,fecha,nom,baseline)
              VALUES (?,?,?,?,?,?,?,?,?,1)`,
        args: [String(base + i), 'SALDO-INICIAL', 'Inventario físico',
          plant, mat, qty, qty, '2026-07-22', nom],
      });
      i++;
    }
    console.log(`✓ ${SEED.length} registros de inventario cargados.`);

    // ── Bodega EMBAJADOR: todos los materiales en ceros ──
    console.log('→ Creando bodega Embajador (en ceros)...');
    for (const mat of MAT_IDS) {
      await db.execute({
        sql: `INSERT INTO facturas (id,num,prov,plant,mat,cant_ini,cant_rest,fecha,nom,baseline)
              VALUES (?,?,?,?,?,?,?,?,?,1)`,
        args: [String(base + i), 'SALDO-INICIAL', 'Bodega nueva',
          'embajador', mat, 0, 0, '2026-07-22', null],
      });
      i++;
    }
    console.log(`✓ Embajador: ${MAT_IDS.length} materiales en cero.`);

    // ── En tránsito ──
    console.log('→ Cargando material en tránsito...');
    let j = 0;
    for (const [plant, mat, cant, nom] of TRANSITO) {
      await db.execute({
        sql: `INSERT INTO transito (id,plant,mat,cant,nom) VALUES (?,?,?,?,?)`,
        args: [String(base + 900000 + j), plant, mat, cant, nom],
      });
      j++;
    }
    console.log(`✓ ${TRANSITO.length} entradas en tránsito cargadas.`);
  }

  console.log('\n✅ Listo. Usuarios de acceso:');
  console.log('   Luisrdv     / Control123    (administrador: ve y edita)');
  console.log('   Eduardordv  / Direccion123  (solo lectura: solo ve)');
  console.log('\n(Recuerda cambiar las contraseñas en producción.)');
  process.exit(0);
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
