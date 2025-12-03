// server.js - Uniformes Escolares Bonaparte
// Servidor con JSON como "base de datos" + respaldos automáticos

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 4000;

// ===== STATIC & HTML =====
const STATIC_DIR = __dirname;
app.use(express.static(STATIC_DIR));

const INDEX_HTML = path.join(__dirname, "app-uniformes-multi.html");
app.get("/", (req, res) => {
  res.sendFile(INDEX_HTML);
});
app.get("/app-uniformes-multi.html", (req, res) => {
  res.sendFile(INDEX_HTML);
});

// ===== MIDDLEWARE BÁSICO =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Carpeta para imágenes subidas
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
app.use("/uploads", express.static(UPLOAD_DIR));

// Carpeta para respaldos
const BACKUP_DIR = path.join(__dirname, "backups");
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ===== "BASE DE DATOS" EN ARCHIVOS JSON =====
const DB_PEDIDOS = path.join(__dirname, "pedidos.json");
const DB_USERS = path.join(__dirname, "users.json");
const DB_IMAGENES = path.join(__dirname, "imagenes.json");

function leerJSON(ruta, valorPorDefecto) {
  try {
    if (!fs.existsSync(ruta)) return valorPorDefecto;
    const txt = fs.readFileSync(ruta, "utf8");
    if (!txt.trim()) return valorPorDefecto;
    return JSON.parse(txt);
  } catch {
    return valorPorDefecto;
  }
}

function escribirJSON(ruta, data) {
  fs.writeFileSync(ruta, JSON.stringify(data, null, 2), "utf8");
}

// Cargamos datos en memoria
let pedidos = leerJSON(DB_PEDIDOS, []);
let usuarios = leerJSON(DB_USERS, []);
let imagenes = leerJSON(DB_IMAGENES, []);

// Usuario admin por defecto si no existe ninguno
if (!usuarios || usuarios.length === 0) {
  usuarios = [
    {
      id: 1,
      nombre: "Administrador",
      email: "admin@local",
      password: "admin123",
      rol: "admin",
    },
  ];
  escribirJSON(DB_USERS, usuarios);
}

// ===== RESPALDOS AUTOMÁTICOS =====
function crearRespaldoLocal() {
  try {
    const ahora = new Date();
    const yyyy = ahora.getFullYear();
    const mm = String(ahora.getMonth() + 1).padStart(2, "0");
    const dd = String(ahora.getDate()).padStart(2, "0");
    const hh = String(ahora.getHours()).padStart(2, "0");
    const mi = String(ahora.getMinutes()).padStart(2, "0");
    const ss = String(ahora.getSeconds()).padStart(2, "0");

    const stamp = `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
    const archivo = path.join(BACKUP_DIR, `respaldo-${stamp}.json`);

    const payload = {
      fecha: ahora.toISOString(),
      pedidos,
      // No guardamos password en el respaldo para más seguridad
      usuarios: usuarios.map((u) => ({
        id: u.id,
        nombre: u.nombre,
        email: u.email,
        rol: u.rol,
      })),
      imagenes,
    };

    fs.writeFileSync(archivo, JSON.stringify(payload, null, 2), "utf8");
    console.log("Respaldo creado:", archivo);
  } catch (err) {
    console.error("Error creando respaldo:", err);
  }
}

// Endpoint para que el admin descargue respaldo
app.get("/api/respaldo", authMiddleware, requireAdmin, (req, res) => {
  const ahora = new Date();
  res.json({
    fecha: ahora.toISOString(),
    pedidos,
    usuarios: usuarios.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
    })),
    imagenes,
  });
});

// ===== AUTENTICACIÓN SUPER SIMPLE =====

const tokensActivos = new Map(); // token -> {id, nombre, rol}

function generarToken(usuario) {
  const token = `tok_${usuario.id}_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;
  tokensActivos.set(token, {
    id: usuario.id,
    nombre: usuario.nombre,
    rol: usuario.rol,
  });
  return token;
}

function authMiddleware(req, res, next) {
  const auth = req.headers["authorization"];
  if (!auth) return res.status(401).json({ error: "No autorizado" });
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ error: "Formato de token inválido" });
  }
  const token = parts[1];
  const user = tokensActivos.get(token);
  if (!user) return res.status(401).json({ error: "Token inválido" });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }
  next();
}

// ===== LOGIN =====
app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Faltan credenciales" });
  }
  const user = usuarios.find(
    (u) => u.email === email && u.password === password
  );
  if (!user) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
  const token = generarToken(user);
  res.json({ token, nombre: user.nombre, rol: user.rol });
});

// ===== CRUD USUARIOS (solo admin) =====

app.get("/api/users", authMiddleware, requireAdmin, (req, res) => {
  res.json(
    usuarios.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
    }))
  );
});

app.post("/api/users", authMiddleware, requireAdmin, (req, res) => {
  const { nombre, email, password, rol } = req.body || {};
  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: "Datos incompletos" });
  }
  if (usuarios.some((u) => u.email === email)) {
    return res.status(400).json({ error: "Ese correo ya existe" });
  }
  const nuevoId =
    usuarios.length > 0 ? Math.max(...usuarios.map((u) => u.id)) + 1 : 1;
  const nuevoUser = { id: nuevoId, nombre, email, password, rol };
  usuarios.push(nuevoUser);
  escribirJSON(DB_USERS, usuarios);
  crearRespaldoLocal();
  res.json({ ok: true, id: nuevoId });
});

app.delete("/api/users/:id", authMiddleware, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const antes = usuarios.length;
  usuarios = usuarios.filter((u) => u.id !== id);
  if (usuarios.length === antes) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }
  escribirJSON(DB_USERS, usuarios);
  crearRespaldoLocal();
  res.json({ ok: true });
});

// ===== GENERACIÓN DE FOLIO =====

function generarFolio() {
  const ahora = new Date();
  const year = ahora.getFullYear();
  const prefix = `BONA-${year}-`;

  const delAnio = pedidos.filter(
    (p) => typeof p.folio === "string" && p.folio.startsWith(prefix)
  );
  const siguiente = delAnio.length + 1;
  const consecutivo = String(siguiente).padStart(4, "0");
  return prefix + consecutivo;
}

// ===== CRUD PEDIDOS =====

app.get("/api/pedidos", authMiddleware, (req, res) => {
  res.json(pedidos);
});

app.post("/api/pedidos", authMiddleware, (req, res) => {
  const body = req.body || {};
  const nuevoId =
    pedidos.length > 0 ? Math.max(...pedidos.map((p) => p.id || 0)) + 1 : 1;

  const pedido = {
    id: nuevoId,
    folio: generarFolio(),
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
    imagenUrl: body.imagenUrl || null,
    creadoEn: new Date().toISOString(),
  };

  pedidos.push(pedido);
  escribirJSON(DB_PEDIDOS, pedidos);
  crearRespaldoLocal();
  res.json(pedido);
});

app.put("/api/pedidos/:id", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const idx = pedidos.findIndex((p) => p.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Pedido no encontrado" });
  }
  const body = req.body || {};
  const actual = pedidos[idx];

  pedidos[idx] = {
    ...actual,
    clienteNombre: body.clienteNombre ?? actual.clienteNombre,
    clienteTelefono: body.clienteTelefono ?? actual.clienteTelefono,
    clienteEscuela: body.clienteEscuela ?? actual.clienteEscuela,
    prendaTipo: body.prendaTipo ?? actual.prendaTipo,
    prendaModelo: body.prendaModelo ?? actual.prendaModelo,
    descripcionGeneral: body.descripcionGeneral ?? actual.descripcionGeneral,
    fechaEntrega: body.fechaEntrega ?? actual.fechaEntrega,
    estado: body.estado ?? actual.estado,
    tallasTexto: body.tallasTexto ?? actual.tallasTexto,
    comprasNotas: body.comprasNotas ?? actual.comprasNotas,
    corteNotas: body.corteNotas ?? actual.corteNotas,
    confeccionNotas: body.confeccionNotas ?? actual.confeccionNotas,
    precioTotal:
      body.precioTotal !== undefined
        ? Number(body.precioTotal || 0)
        : actual.precioTotal,
    anticipo:
      body.anticipo !== undefined ? Number(body.anticipo || 0) : actual.anticipo,
    saldo:
      body.saldo !== undefined ? Number(body.saldo || 0) : actual.saldo,
    gastosCompras:
      body.gastosCompras !== undefined
        ? Number(body.gastosCompras || 0)
        : actual.gastosCompras,
    imagenUrl: body.imagenUrl ?? actual.imagenUrl,
  };

  escribirJSON(DB_PEDIDOS, pedidos);
  crearRespaldoLocal();
  res.json(pedidos[idx]);
});

app.delete("/api/pedidos/:id", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const antes = pedidos.length;
  pedidos = pedidos.filter((p) => p.id !== id);
  if (pedidos.length === antes) {
    return res.status(404).json({ error: "Pedido no encontrado" });
  }
  escribirJSON(DB_PEDIDOS, pedidos);

  // Borrar registros de imágenes de ese pedido
  imagenes = imagenes.filter((img) => img.pedidoId !== id);
  escribirJSON(DB_IMAGENES, imagenes);

  crearRespaldoLocal();
  res.json({ ok: true });
});

// ===== SUBIDA DE IMÁGENES =====

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".jpg";
    const nombre = `pedido_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}${ext}`;
    cb(null, nombre);
  },
});

const upload = multer({ storage });

app.post(
  "/api/pedidos/:id/imagen",
  authMiddleware,
  upload.single("imagen"),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    const pedido = pedidos.find((p) => p.id === id);
    if (!pedido) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió archivo" });
    }

    const rutaRelativa = "/uploads/" + req.file.filename;

    const nuevoId =
      imagenes.length > 0 ? Math.max(...imagenes.map((i) => i.id || 0)) + 1 : 1;
    const registro = {
      id: nuevoId,
      pedidoId: id,
      imagenUrl: rutaRelativa,
      creadoEn: new Date().toISOString(),
    };
    imagenes.push(registro);
    escribirJSON(DB_IMAGENES, imagenes);

    // Última imagen también se guarda en el pedido
    pedido.imagenUrl = rutaRelativa;
    escribirJSON(DB_PEDIDOS, pedidos);

    crearRespaldoLocal();
    res.json({ ok: true, imagenUrl: rutaRelativa });
  }
);

app.get("/api/pedidos/:id/imagenes", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const lista = imagenes.filter((img) => img.pedidoId === id);
  res.json(lista);
});

// ===== ARRANQUE SERVIDOR =====

app.listen(PORT, "0.0.0.0", () => {
  console.log("=================================");
  console.log("  Servidor Uniformes Bonaparte");
  console.log("  Puerto:", PORT);
  console.log("=================================");
});
