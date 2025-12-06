// server.js - Uniformes Escolares Bonaparte (listo para Railway + volumen)
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 4000;

// -------------------- CONFIG BÁSICA --------------------
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// En Railway Nixpacks pone el código en /app
// Vamos a usar un ROOT para almacenamiento que puede ser:
// - En local: la carpeta del proyecto (__dirname)
// - En Railway: el volumen montado (RAILWAY_VOLUME_MOUNT_PATH), que vamos a montar en /app/storage
const PUBLIC_DIR = __dirname;
const STORAGE_ROOT = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? process.env.RAILWAY_VOLUME_MOUNT_PATH
  : path.join(__dirname, "storage");

const DATA_DIR = path.join(STORAGE_ROOT, "data");
const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");

// Crear carpetas si no existen
if (!fs.existsSync(STORAGE_ROOT)) fs.mkdirSync(STORAGE_ROOT, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Archivos de datos
const PEDIDOS_FILE = path.join(DATA_DIR, "pedidos.json");
const USUARIOS_FILE = path.join(DATA_DIR, "usuarios.json");
const IMAGENES_FILE = path.join(DATA_DIR, "imagenes.json");

// -------------------- UTILIDADES DE PERSISTENCIA --------------------
function loadJSON(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error cargando", filePath, err);
    return defaultValue;
  }
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Error guardando", filePath, err);
  }
}

// -------------------- DATOS EN MEMORIA (CARGADOS DESDE DISCO) --------------------
let pedidos = loadJSON(PEDIDOS_FILE, []);
let usuarios = loadJSON(USUARIOS_FILE, []);
let imagenes = loadJSON(IMAGENES_FILE, []);

// Si no hay usuarios, crear admin por defecto
if (usuarios.length === 0) {
  usuarios.push({
    id: 1,
    nombre: "Administrador",
    email: "admin@local",
    password: "admin123",
    rol: "admin",
  });
  saveJSON(USUARIOS_FILE, usuarios);
  console.log("Usuario admin por defecto creado: admin@local / admin123");
}

// Para id autoincremental
function nextId(items) {
  let max = 0;
  for (const it of items) if (it.id > max) max = it.id;
  return max + 1;
}

// Sesiones simples en memoria
const sesiones = {}; // token -> { userId, nombre, rol }

// -------------------- AUTENTICACIÓN --------------------
function authMiddleware(req, res, next) {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No autorizado" });
  }
  const token = auth.substring("Bearer ".length);
  const sesion = sesiones[token];
  if (!sesion) {
    return res.status(401).json({ error: "Sesión no válida" });
  }
  req.user = sesion;
  next();
}

// POST /api/login
app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Falta correo o contraseña" });
  }

  const user = usuarios.find(
    (u) => u.email === email && u.password === password
  );
  if (!user) {
    return res.status(401).json({ error: "Credenciales incorrectas" });
  }

  const token = Date.now().toString() + "-" + user.id.toString();
  sesiones[token] = {
    userId: user.id,
    nombre: user.nombre,
    rol: user.rol,
  };

  res.json({
    token,
    nombre: user.nombre,
    rol: user.rol,
  });
});

// -------------------- PEDIDOS --------------------

// GET /api/pedidos
app.get("/api/pedidos", authMiddleware, (req, res) => {
  res.json(pedidos);
});

// POST /api/pedidos
app.post("/api/pedidos", authMiddleware, (req, res) => {
  const body = req.body || {};
  const id = nextId(pedidos);
  const folio = body.folio || "BONA-" + String(1000 + id);

  const nuevo = {
    id,
    folio,
    clienteNombre: body.clienteNombre || "",
    clienteTelefono: body.clienteTelefono || "",
    clienteEscuela: body.clienteEscuela || "",
    prendaTipo: body.prendaTipo || "",
    prendaModelo: body.prendaModelo || "",
    descripcionGeneral: body.descripcionGeneral || "",
    fechaEntrega: body.fechaEntrega || "",
    estado: body.estado || "nuevo",
    tallasTexto: body.tallasTexto || "",
    comprasNotas: body.comprasNotas || "",
    corteNotas: body.corteNotas || "",
    confeccionNotas: body.confeccionNotas || "",
    precioTotal: Number(body.precioTotal || 0),
    anticipo: Number(body.anticipo || 0),
    saldo: Number(body.saldo || 0),
    gastosCompras: Number(body.gastosCompras || 0),
    condicionesCliente: body.condicionesCliente || "",
    comprasDetalle: body.comprasDetalle || "",
    imagenUrl: body.imagenUrl || null,
    creadoEn: new Date().toISOString(),
    actualizadoEn: new Date().toISOString(),
  };

  pedidos.push(nuevo);
  saveJSON(PEDIDOS_FILE, pedidos);

  res.status(201).json(nuevo);
});

// PUT /api/pedidos/:id
app.put("/api/pedidos/:id", authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const idx = pedidos.findIndex((p) => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Pedido no encontrado" });

  const body = req.body || {};
  const original = pedidos[idx];

  const actualizado = {
    ...original,
    clienteNombre: body.clienteNombre ?? original.clienteNombre,
    clienteTelefono: body.clienteTelefono ?? original.clienteTelefono,
    clienteEscuela: body.clienteEscuela ?? original.clienteEscuela,
    prendaTipo: body.prendaTipo ?? original.prendaTipo,
    prendaModelo: body.prendaModelo ?? original.prendaModelo,
    descripcionGeneral: body.descripcionGeneral ?? original.descripcionGeneral,
    fechaEntrega: body.fechaEntrega ?? original.fechaEntrega,
    estado: body.estado ?? original.estado,
    tallasTexto: body.tallasTexto ?? original.tallasTexto,
    comprasNotas: body.comprasNotas ?? original.comprasNotas,
    corteNotas: body.corteNotas ?? original.corteNotas,
    confeccionNotas: body.confeccionNotas ?? original.confeccionNotas,
    precioTotal: body.precioTotal != null ? Number(body.precioTotal) : original.precioTotal,
    anticipo: body.anticipo != null ? Number(body.anticipo) : original.anticipo,
    saldo: body.saldo != null ? Number(body.saldo) : original.saldo,
    gastosCompras: body.gastosCompras != null ? Number(body.gastosCompras) : original.gastosCompras,
    condicionesCliente: body.condicionesCliente ?? original.condicionesCliente,
    comprasDetalle: body.comprasDetalle ?? original.comprasDetalle,
    imagenUrl: body.imagenUrl ?? original.imagenUrl,
    actualizadoEn: new Date().toISOString(),
  };

  pedidos[idx] = actualizado;
  saveJSON(PEDIDOS_FILE, pedidos);

  res.json(actualizado);
});

// DELETE /api/pedidos/:id
app.delete("/api/pedidos/:id", authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const idx = pedidos.findIndex((p) => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Pedido no encontrado" });

  pedidos.splice(idx, 1);
  saveJSON(PEDIDOS_FILE, pedidos);

  const restantes = imagenes.filter((img) => img.pedidoId !== id);
  if (restantes.length !== imagenes.length) {
    imagenes = restantes;
    saveJSON(IMAGENES_FILE, imagenes);
  }

  res.json({ ok: true });
});

// -------------------- IMÁGENES DE PEDIDOS --------------------
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".jpg";
    const base = path.basename(file.originalname, ext).replace(/\s+/g, "_");
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, base + "-" + unique + ext);
  },
});
const upload = multer({ storage });

// POST /api/pedidos/:id/imagen
app.post(
  "/api/pedidos/:id/imagen",
  authMiddleware,
  upload.single("imagen"),
  (req, res) => {
    const idPedido = Number(req.params.id);
    const pedido = pedidos.find((p) => p.id === idPedido);
    if (!pedido) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió archivo" });
    }

    // En Railway, UPLOADS_DIR estará dentro del volumen, pero la URL pública se expone como /uploads
    const relativeUrl = "/uploads/" + req.file.filename;

    const img = {
      id: nextId(imagenes),
      pedidoId: idPedido,
      imagenUrl: relativeUrl,
      creadoEn: new Date().toISOString(),
    };
    imagenes.push(img);
    saveJSON(IMAGENES_FILE, imagenes);

    if (!pedido.imagenUrl) {
      pedido.imagenUrl = relativeUrl;
      pedido.actualizadoEn = new Date().toISOString();
      saveJSON(PEDIDOS_FILE, pedidos);
    }

    res.status(201).json(img);
  }
);

// GET /api/pedidos/:id/imagenes
app.get("/api/pedidos/:id/imagenes", authMiddleware, (req, res) => {
  const idPedido = Number(req.params.id);
  const lista = imagenes.filter((img) => img.pedidoId === idPedido);
  res.json(lista);
});

// -------------------- USUARIOS --------------------

// GET /api/users
app.get("/api/users", authMiddleware, (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }
  const sinPass = usuarios.map(({ password, ...u }) => u);
  res.json(sinPass);
});

// POST /api/users
app.post("/api/users", authMiddleware, (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }
  const { nombre, email, password, rol } = req.body || {};
  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: "Faltan campos" });
  }
  if (usuarios.some((u) => u.email === email)) {
    return res.status(400).json({ error: "Ese correo ya existe" });
  }

  const id = nextId(usuarios);
  const nuevo = { id, nombre, email, password, rol };
  usuarios.push(nuevo);
  saveJSON(USUARIOS_FILE, usuarios);

  const { password: _p, ...sinPass } = nuevo;
  res.status(201).json(sinPass);
});

// DELETE /api/users/:id
app.delete("/api/users/:id", authMiddleware, (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }
  const id = Number(req.params.id);
  const idx = usuarios.findIndex((u) => u.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }
  usuarios.splice(idx, 1);
  saveJSON(USUARIOS_FILE, usuarios);
  res.json({ ok: true });
});

// -------------------- RESPALDO --------------------
app.get("/api/respaldo", authMiddleware, (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }
  res.json({
    pedidos,
    usuarios: usuarios.map(({ password, ...u }) => u),
    imagenes,
    generadoEn: new Date().toISOString(),
  });
});

// -------------------- ARCHIVOS ESTÁTICOS --------------------
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "app-uniformes-multi.html"));
});

// -------------------- ARRANQUE --------------------
app.listen(PORT, () => {
  console.log("=================================");
  console.log("  Servidor Bonaparte en puerto", PORT);
  console.log("  http://localhost:" + PORT + "/");
  console.log("  STORAGE_ROOT:", STORAGE_ROOT);
  console.log("=================================");
});
