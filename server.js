// server.js - Uniformes Escolares Bonaparte usando Supabase (Render + DB estable)
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 4000;

// -------------------- SUPABASE --------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en variables de entorno.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// -------------------- CONFIG BÁSICA --------------------
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PUBLIC_DIR = __dirname;
const UPLOADS_DIR = path.join(__dirname, "uploads");

// Crear carpeta uploads (solo para guardado local; en Render puede ser efímero)
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Sesiones simples en memoria
const sesiones = {}; // token -> { userId, nombre, rol }

// -------------------- MULTER (para subir imágenes a disco local) --------------------
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

// -------------------- HELPERS DE MAPEO --------------------
function mapPedidoFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    folio: row.folio,
    clienteNombre: row.cliente_nombre,
    clienteTelefono: row.cliente_telefono,
    clienteEscuela: row.cliente_escuela,
    prendaTipo: row.prenda_tipo,
    prendaModelo: row.prenda_modelo,
    descripcionGeneral: row.descripcion_general,
    fechaEntrega: row.fecha_entrega,
    estado: row.estado,
    tallasTexto: row.tallas_texto,
    comprasNotas: row.compras_notas,
    corteNotas: row.corte_notas,
    confeccionNotas: row.confeccion_notas,
    precioTotal: Number(row.precio_total || 0),
    anticipo: Number(row.anticipo || 0),
    saldo: Number(row.saldo || 0),
    gastosCompras: Number(row.gastos_compras || 0),
    condicionesCliente: row.condiciones_cliente,
    comprasDetalle: row.compras_detalle,
    imagenUrl: row.imagen_url,
    creadoEn: row.creado_en,
    actualizadoEn: row.actualizado_en,
  };
}

function mapPedidoToDb(body, extra = {}) {
  return {
    folio: body.folio,
    cliente_nombre: body.clienteNombre,
    cliente_telefono: body.clienteTelefono,
    cliente_escuela: body.clienteEscuela,
    prenda_tipo: body.prendaTipo,
    prenda_modelo: body.prendaModelo,
    descripcion_general: body.descripcionGeneral,
    fecha_entrega: body.fechaEntrega,
    estado: body.estado,
    tallas_texto: body.tallasTexto,
    compras_notas: body.comprasNotas,
    corte_notas: body.corteNotas,
    confeccion_notas: body.confeccionNotas,
    precio_total: body.precioTotal,
    anticipo: body.anticipo,
    saldo: body.saldo,
    gastos_compras: body.gastosCompras,
    condiciones_cliente: body.condicionesCliente,
    compras_detalle: body.comprasDetalle,
    imagen_url: body.imagenUrl,
    ...extra,
  };
}

function mapImagenFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    pedidoId: row.pedido_id,
    imagenUrl: row.imagen_url,
    creadoEn: row.creado_en,
  };
}

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
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Falta correo o contraseña" });
  }

  const { data, error } = await supabase
    .from("usuarios")
    .select("*")
    .eq("email", email)
    .eq("password", password)
    .limit(1);

  if (error) {
    console.error("Error login:", error);
    return res.status(500).json({ error: "Error en servidor" });
  }

  const user = data && data[0];
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
app.get("/api/pedidos", authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from("pedidos")
    .select("*")
    .order("id", { ascending: false });

  if (error) {
    console.error("Error get pedidos:", error);
    return res.status(500).json({ error: "Error al obtener pedidos" });
  }

  const mapped = data.map(mapPedidoFromDb);
  res.json(mapped);
});

// POST /api/pedidos
app.post("/api/pedidos", authMiddleware, async (req, res) => {
  const body = req.body || {};

  // generar folio si no viene
  const { data: maxData, error: maxError } = await supabase
    .from("pedidos")
    .select("id")
    .order("id", { ascending: false })
    .limit(1);

  if (maxError) {
    console.error("Error obteniendo max id:", maxError);
  }
  const lastId = maxData && maxData[0] ? maxData[0].id : 0;
  const nuevoId = Number(lastId) + 1;
  const folio = body.folio || "BONA-" + String(1000 + nuevoId);

  const payload = mapPedidoToDb(
    {
      ...body,
      folio,
      precioTotal: Number(body.precioTotal || 0),
      anticipo: Number(body.anticipo || 0),
      saldo: Number(body.saldo || 0),
      gastosCompras: Number(body.gastosCompras || 0),
    },
    {
      creado_en: new Date().toISOString(),
      actualizado_en: new Date().toISOString(),
    }
  );

  const { data, error } = await supabase
    .from("pedidos")
    .insert(payload)
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error creando pedido:", error);
    return res.status(500).json({ error: "Error al crear pedido" });
  }

  const row = data[0];
  res.status(201).json(mapPedidoFromDb(row));
});

// PUT /api/pedidos/:id
app.put("/api/pedidos/:id", authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};

  // primero obtener el existente
  const { data: existingData, error: existingError } = await supabase
    .from("pedidos")
    .select("*")
    .eq("id", id)
    .limit(1);

  if (existingError) {
    console.error("Error consultando pedido:", existingError);
    return res.status(500).json({ error: "Error en servidor" });
  }
  const original = existingData && existingData[0];
  if (!original) {
    return res.status(404).json({ error: "Pedido no encontrado" });
  }

  const merged = {
    folio: body.folio ?? original.folio,
    clienteNombre: body.clienteNombre ?? original.cliente_nombre,
    clienteTelefono: body.clienteTelefono ?? original.cliente_telefono,
    clienteEscuela: body.clienteEscuela ?? original.cliente_escuela,
    prendaTipo: body.prendaTipo ?? original.prenda_tipo,
    prendaModelo: body.prendaModelo ?? original.prenda_modelo,
    descripcionGeneral: body.descripcionGeneral ?? original.descripcion_general,
    fechaEntrega: body.fechaEntrega ?? original.fecha_entrega,
    estado: body.estado ?? original.estado,
    tallasTexto: body.tallasTexto ?? original.tallas_texto,
    comprasNotas: body.comprasNotas ?? original.compras_notas,
    corteNotas: body.corteNotas ?? original.corte_notas,
    confeccionNotas: body.confeccionNotas ?? original.confeccion_notas,
    precioTotal:
      body.precioTotal != null
        ? Number(body.precioTotal)
        : Number(original.precio_total || 0),
    anticipo:
      body.anticipo != null
        ? Number(body.anticipo)
        : Number(original.anticipo || 0),
    saldo:
      body.saldo != null ? Number(body.saldo) : Number(original.saldo || 0),
    gastosCompras:
      body.gastosCompras != null
        ? Number(body.gastosCompras)
        : Number(original.gastos_compras || 0),
    condicionesCliente:
      body.condicionesCliente ?? original.condiciones_cliente,
    comprasDetalle: body.comprasDetalle ?? original.compras_detalle,
    imagenUrl: body.imagenUrl ?? original.imagen_url,
  };

  const payload = mapPedidoToDb(merged, {
    actualizado_en: new Date().toISOString(),
  });

  const { data, error } = await supabase
    .from("pedidos")
    .update(payload)
    .eq("id", id)
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error actualizando pedido:", error);
    return res.status(500).json({ error: "Error al actualizar pedido" });
  }

  res.json(mapPedidoFromDb(data[0]));
});

// DELETE /api/pedidos/:id
app.delete("/api/pedidos/:id", authMiddleware, async (req, res) => {
  const id = Number(req.params.id);

  // Borrar imágenes relacionadas en tabla imagenes
  const { error: imgDelError } = await supabase
    .from("imagenes")
    .delete()
    .eq("pedido_id", id);
  if (imgDelError) {
    console.error("Error borrando imag de pedido:", imgDelError);
  }

  const { error } = await supabase.from("pedidos").delete().eq("id", id);
  if (error) {
    console.error("Error borrando pedido:", error);
    return res.status(500).json({ error: "Error al eliminar pedido" });
  }

  res.json({ ok: true });
});

// -------------------- IMÁGENES DE PEDIDOS --------------------

// POST /api/pedidos/:id/imagen
app.post(
  "/api/pedidos/:id/imagen",
  authMiddleware,
  upload.single("imagen"),
  async (req, res) => {
    const idPedido = Number(req.params.id);

    // Verificar pedido
    const { data: pedidoData, error: pedidoError } = await supabase
      .from("pedidos")
      .select("*")
      .eq("id", idPedido)
      .limit(1);

    if (pedidoError) {
      console.error("Error consultando pedido:", pedidoError);
      return res.status(500).json({ error: "Error en servidor" });
    }
    const pedido = pedidoData && pedidoData[0];
    if (!pedido) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió archivo" });
    }

    const relativeUrl = "/uploads/" + req.file.filename;

    // Guardar en tabla imagenes
    const { data, error } = await supabase
      .from("imagenes")
      .insert({
        pedido_id: idPedido,
        imagen_url: relativeUrl,
      })
      .select("*")
      .limit(1);

    if (error) {
      console.error("Error guardando imagen en DB:", error);
      return res.status(500).json({ error: "Error al guardar imagen" });
    }
    const imgRow = data[0];

    // Asignar imagen principal si no tiene
    if (!pedido.imagen_url) {
      const { error: updError } = await supabase
        .from("pedidos")
        .update({
          imagen_url: relativeUrl,
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", idPedido);
      if (updError) {
        console.error("Error actualizando imagen principal:", updError);
      }
    }

    res.status(201).json(mapImagenFromDb(imgRow));
  }
);

// GET /api/pedidos/:id/imagenes
app.get("/api/pedidos/:id/imagenes", authMiddleware, async (req, res) => {
  const idPedido = Number(req.params.id);
  const { data, error } = await supabase
    .from("imagenes")
    .select("*")
    .eq("pedido_id", idPedido)
    .order("id", { ascending: true });

  if (error) {
    console.error("Error obteniendo imagenes:", error);
    return res.status(500).json({ error: "Error al obtener imágenes" });
  }

  const mapped = data.map(mapImagenFromDb);
  res.json(mapped);
});

// -------------------- USUARIOS --------------------

// GET /api/users
app.get("/api/users", authMiddleware, async (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }

  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nombre, email, rol");

  if (error) {
    console.error("Error obteniendo usuarios:", error);
    return res.status(500).json({ error: "Error al obtener usuarios" });
  }

  res.json(data);
});

// POST /api/users
app.post("/api/users", authMiddleware, async (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }

  const { nombre, email, password, rol } = req.body || {};
  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: "Faltan campos" });
  }

  // Verificar que no exista el correo
  const { data: existing, error: existingError } = await supabase
    .from("usuarios")
    .select("id")
    .eq("email", email)
    .limit(1);

  if (existingError) {
    console.error("Error verificando usuario:", existingError);
    return res.status(500).json({ error: "Error en servidor" });
  }
  if (existing && existing[0]) {
    return res.status(400).json({ error: "Ese correo ya existe" });
  }

  const { data, error } = await supabase
    .from("usuarios")
    .insert({
      nombre,
      email,
      password,
      rol,
    })
    .select("id, nombre, email, rol")
    .limit(1);

  if (error) {
    console.error("Error creando usuario:", error);
    return res.status(500).json({ error: "Error al crear usuario" });
  }

  res.status(201).json(data[0]);
});

// DELETE /api/users/:id
app.delete("/api/users/:id", authMiddleware, async (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }

  const id = Number(req.params.id);

  const { error } = await supabase.from("usuarios").delete().eq("id", id);

  if (error) {
    console.error("Error eliminando usuario:", error);
    return res.status(500).json({ error: "Error al eliminar usuario" });
  }

  res.json({ ok: true });
});

// -------------------- RESPALDO --------------------
app.get("/api/respaldo", authMiddleware, async (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }

  const [pedidosRes, usuariosRes, imagenesRes] = await Promise.all([
    supabase.from("pedidos").select("*"),
    supabase.from("usuarios").select("id, nombre, email, rol"),
    supabase.from("imagenes").select("*"),
  ]);

  if (pedidosRes.error || usuariosRes.error || imagenesRes.error) {
    console.error("Error generando respaldo:", {
      pedidos: pedidosRes.error,
      usuarios: usuariosRes.error,
      imagenes: imagenesRes.error,
    });
    return res.status(500).json({ error: "Error al generar respaldo" });
  }

  res.json({
    pedidos: pedidosRes.data,
    usuarios: usuariosRes.data,
    imagenes: imagenesRes.data,
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
  console.log("=================================");
});
