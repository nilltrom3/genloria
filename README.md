# 🌳 GENLORIA — v1

**Generaciones unidas · Historias que perduran.**

Red social **privada** para la familia, instalable como app en el celular (PWA).
Publicaciones con texto, fotos y videos · Historias de 24 horas · Likes y comentarios · Perfiles · **Árbol genealógico**.

**Stack:** Node.js + Express + SQLite · Sin compilación de frontend (JS vanilla) · Todo en una sola unidad.

---

## 🚀 Probarla en local (2 minutos)

```bash
cd app
npm install
npm start
```

Abre **http://localhost:3000** en el celular o la computadora.

**Primera vez:**
- Usuario admin: `admin` · Contraseña: `Cambiar123!`
- Código de invitación para registrar familia: `FAMILIA-2026`

> ⚠️ **Apenas entres, cambia la contraseña del admin** (Perfil → Editar perfil → Cambiar contraseña) y genera códigos de invitación nuevos desde **Administración**.

### Instalarla como app en el celular (PWA)

En la misma red Wi-Fi del servidor:

1. En el celular abre `http://TU-IP:3000` (ej: `http://192.168.1.10:3000`).
2. **Android (Chrome):** menú ⋮ → *Instalar app* / *Añadir a pantalla de inicio*.
3. **iPhone (Safari):** compartir → *Añadir a pantalla de inicio*.

Queda con su propio ícono y abre a pantalla completa, como una app.

---

## ☁️ Desplegarla en internet

### Opción A — Render (gratis, más fácil)

1. Sube esta carpeta `app/` a un repositorio de GitHub.
2. En [render.com](https://render.com) → *New* → *Web Service* → conecta el repo.
3. Render detecta el `render.yaml` automáticamente.
4. En el dashboard define la variable **`ADMIN_PASS`** (no la dejes por defecto).
5. Despliega. Te dará una URL `https://tu-app.onrender.com`.

### Opción B — Railway

1. Sube el repo a GitHub.
2. En [railway.app](https://railway.app) → *New Project* → *Deploy from GitHub*.
3. Añade las variables de entorno (ver tabla abajo).
4. Añade un **volumen** montado en `/app/data` y otro en `/app/uploads` para no perder datos.

### Opción C — VPS propio (Docker)

```bash
# En el servidor, crea un .env con tus valores (ver .env.example)
docker compose up -d --build
```

La app queda en `http://TU-SERVIDOR:3000`. Para HTTPS usa un proxy inverso
(Nginx + Let's Encrypt) o Cloudflare Tunnel.

---

## ⚙️ Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de escucha |
| `NODE_ENV` | `development` | `production` activa cookies seguras (HTTPS) |
| `SESSION_SECRET` | *(demo)* | **Obligatorio cambiarlo en producción.** Secreto para las sesiones |
| `ADMIN_USER` / `ADMIN_PASS` | `admin` / `Cambiar123!` | Cuenta admin creada en el primer arranque. **Cambia la contraseña** |
| `INVITE_CODE` | `FAMILIA-2026` | Código de invitación inicial (el admin puede crear más) |
| `MAX_PHOTO_MB` | `10` | Tamaño máximo por foto |
| `MAX_VIDEO_MB` | `100` | Tamaño máximo por video |
| `DB_PATH` / `UPLOAD_DIR` | `./data/…` `./uploads/` | Dónde se guardan la base de datos y los archivos |

**Límites de subida:** fotos hasta 10 MB, videos hasta 100 MB, avatares hasta 5 MB
(ajustables con las variables). Los archivos se guardan en el disco del servidor,
en la carpeta `uploads/`.

---

## 🛠 Administración (dentro de la app)

Con la cuenta admin: **Perfil → Administración**

- **Usuarios:** ver miembros y crear cuentas (con nombre y correo; el familiar elige su propia clave con el código que se genera — el admin nunca la ve).
- **Códigos:** generar códigos de invitación (ilimitados o con tope de usos) y desactivarlos.
- **🔑 Recuperación de clave:** si un familiar olvida su clave, el admin le genera un código de recuperación de un solo uso (válido 24 h) y se lo comparte; el familiar lo ingresa en **"Olvidé mi clave"** y elige su clave nueva. El admin no puede ver claves ni entrar a cuentas de otros (privacidad).
- **Árbol:** gestionar la estructura familiar y revisar propuestas.

Las historias se borran solas a las 24 horas.

---

## 🌳 Módulo: Árbol genealógico

Pestaña **🌳 Árbol** en la barra inferior: visualización interactiva por
generaciones (padres arriba, hijos debajo, parejas unidas con línea),
con zoom (+/−) y desplazamiento. Toca una persona para ver su perfil o
**proponer una corrección**.

**Permisos (simple y seguro):**
- **Administrador:** crea y quita relaciones (padre/madre ↔ hijo/a, parejas).
  El sistema rechaza ciclos, duplicados y dobles parejas.
- **Miembros:** pueden **proponer** correcciones (agregar/quitar padre o pareja),
  con nota opcional. El admin las aprueba o rechaza desde la pestaña Árbol.

Las personas sin relaciones aparecen en la sección *"Sin relaciones registradas"*.

---

## 🔒 Notas de seguridad

- Contraseñas con hash **bcrypt** (12 rondas). Las sesiones viven en SQLite.
- Límite de intentos en login/registro (30 por 15 min por IP).
- Cabeceras de seguridad con `helmet`.
- **Pendiente de endurecer (fase 2):** tokens CSRF, HTTPS obligatorio, copias de
  seguridad automáticas, almacenamiento externo para archivos.

## 🗺 Fases futuras (NO incluidas en v1)

- **Fase 2:** Rastreo familiar en tiempo real con notificaciones de cercanía.
- Notificaciones push, mensajes directos, copias de seguridad automáticas.

---

*Hecho para la familia 💛 — v1.0.0*
