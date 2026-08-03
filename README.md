# Real del Valle · Sistema de Inventario

Sistema de control de inventario para las 3 plantas (Cuermaro, Degollado, Arandas/PB).
Stack: **Express + Turso + JWT**, desplegado en **Railway**, código en **GitHub**.

---

## Estructura del proyecto

```
rdv-cloud/
├── server.js              ← servidor Express (API + sirve el frontend)
├── importar_directo.js    ← crea tablas, usuario y carga inventario en Turso
├── package.json
├── .env.example           ← plantilla de variables de entorno
├── .gitignore
└── public/
    └── index.html         ← la aplicación completa (frontend)
```

---

## PASO 1 · Crear la base de datos en Turso

1. Entra a https://turso.tech e inicia sesión.
2. Crea una base nueva, por ejemplo: `rdv-inventario` (región `aws-us-east-1`, igual que NEXOS).
3. Copia el **Database URL** (empieza con `libsql://...`).
4. Genera un **token** (`Create Token`) y cópialo.

---

## PASO 2 · Subir el código a GitHub

```bash
cd rdv-cloud
git init
git add .
git commit -m "Real del Valle inventario - inicial"
git branch -M main
git remote add origin https://github.com/luiscardenaspjm-collab/rdv-inventario.git
git push -u origin main
```

---

## PASO 3 · Cargar el inventario inicial en Turso (directo, sin Railway)

Igual que tu patrón de NEXOS con `importar_directo.js`:

```bash
npm install
export TURSO_DATABASE_URL="libsql://rdv-inventario-....turso.io"
export TURSO_AUTH_TOKEN="el-token-que-copiaste"
node importar_directo.js
```

Esto crea las tablas, el usuario admin y carga el inventario del 10-Jun-2026.
Al terminar te imprime el usuario y contraseña de acceso.

> **Tip:** si necesitas cambiar usuario/contraseña antes de correrlo:
> `export ADMIN_USER="luis"` y `export ADMIN_PASS="tu-clave"`

---

## PASO 4 · Desplegar en Railway

1. En Railway: **New Project → Deploy from GitHub repo** → elige `rdv-inventario`.
2. Railway detecta Node y usa `npm start` automáticamente.
3. Ve a la pestaña **Variables** y agrega:

   | Variable | Valor |
   |---|---|
   | `TURSO_DATABASE_URL` | `libsql://rdv-inventario-....turso.io` |
   | `TURSO_AUTH_TOKEN` | tu token de Turso |
   | `JWT_SECRET` | una clave larga y aleatoria que inventes |

4. Railway redespliega solo. Cuando termine, en **Settings → Networking → Generate Domain**
   obtienes tu URL pública (algo como `https://rdv-inventario-production.up.railway.app`).

---

## PASO 5 · Entrar

Abre la URL de Railway, inicia sesión con el usuario y contraseña que creó el script
(por defecto `luis` / `realdelvalle2026`) y listo: tu inventario en la nube,
accesible desde cualquier lugar.

---

## Notas técnicas

- **Single-service**: Express sirve el frontend con `express.static` y expone la API
  en `/api/*` — mismo patrón que NEXOS PDV (sin hosting separado de frontend).
- **Sesión**: el token JWT se guarda en `sessionStorage` del navegador y dura 30 días.
- **Salidas**: el descuento de facturas y litros de granel se hace en una sola
  transacción (`db.batch`) en el servidor, de forma atómica.
- **Para futuras migraciones de datos masivos** usa siempre `importar_directo.js`
  (apuntando directo a Turso, no a Railway).

## Cambiar la contraseña más adelante

Vuelve a correr `node importar_directo.js` con `ADMIN_PASS` distinto;
el script actualiza la contraseña del usuario sin tocar el inventario ya cargado.
