const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN || '',
});

async function ajustar() {
  console.log('→ Consultando stock actual en Degollado...');

  const tapas = await db.execute(
    "SELECT id, cant_rest FROM facturas WHERE plant='degollado' AND mat='tapa_n' ORDER BY cant_rest DESC"
  );
  const corchos = await db.execute(
    "SELECT id, cant_rest FROM facturas WHERE plant='degollado' AND mat='corcho_1750' ORDER BY cant_rest DESC"
  );

  console.log('Tapas Negras:', tapas.rows.map(r => `id:${r.id} rest:${r.cant_rest}`).join(' | '));
  console.log('Corchos 1750:', corchos.rows.length ? corchos.rows.map(r => `id:${r.id} rest:${r.cant_rest}`).join(' | ') : 'ninguno');

  const CANT = 1056; // 4 tarimas × 264

  // 1) Devolver 1,056 tapas negras
  const tapaRow = tapas.rows[0];
  if (!tapaRow) { console.log('ERROR: No se encontró registro de tapa negra'); process.exit(1); }
  const nuevaTapa = Number(tapaRow.cant_rest) + CANT;
  await db.execute({ sql: "UPDATE facturas SET cant_rest=? WHERE id=?", args: [nuevaTapa, tapaRow.id] });
  console.log(`✓ Tapa Negra devuelta: ${tapaRow.cant_rest} → ${nuevaTapa}`);

  // 2) Descontar 1,056 corchos 1750
  if (!corchos.rows.length) {
    // No hay registro de corcho 1750 en Degollado — creamos el ajuste
    const id = String(Date.now());
    await db.execute({
      sql: "INSERT INTO facturas (id,num,prov,plant,mat,cant_ini,cant_rest,fecha) VALUES (?,?,?,?,?,?,?,?)",
      args: [id, 'AJUSTE-CA28-35', 'Ajuste manual 1750', 'degollado', 'corcho_1750', 0, -CANT, '2026-08-10'],
    });
    console.log(`⚠  No había corchos 1750 en Degollado — creado registro en -${CANT}`);
  } else {
    const corRow = corchos.rows[0];
    const nuevoCorcho = Number(corRow.cant_rest) - CANT;
    await db.execute({ sql: "UPDATE facturas SET cant_rest=? WHERE id=?", args: [nuevoCorcho, corRow.id] });
    console.log(`✓ Corcho 1750 descontado: ${corRow.cant_rest} → ${nuevoCorcho}`);
  }

  console.log('\n✅ Ajuste completado. Recarga el sistema para ver los cambios.');
  process.exit(0);
}

ajustar().catch(e => { console.error('Error:', e.message); process.exit(1); });
