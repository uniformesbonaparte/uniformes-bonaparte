// =========================
//  UNIFORMES BONAPARTE
//  SERVER.JS
//  - Supabase DB (campos mapeados a camelCase)
//  - Supabase Storage para imágenes
// =========================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
app.use(express.static(path.join(__dirname, "public")));
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const { supabase, STORAGE_BUCKET } = require("./supabaseClient");

const app = express();
// Configuración de multer (subir archivos a memoria)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// RUTA DE PRUEBA PARA SUBIR UNA IMAGEN
app.post("/test-imagen", upload.single("imagen"), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).send("No se recibió ningún archivo");
  }

  try {
    const fileExt = file.originalname.split(".").pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `tests/${fileName}`;

    // 1) Subir al bucket de Supabase
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("Error subiendo a Supabase Storage:", uploadError);
      return res.status(500).send("Error subiendo la imagen");
    }

    // 2) Obtener URL pública
    const { data: publicData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = publicData?.publicUrl;

    return res.send(`
      <p>Imagen subida correctamente ✅</p>
      <p>URL pública:</p>
      <a href="${publicUrl}" target="_blank">${publicUrl}</a>
      <br><br>
      <img src="${publicUrl}" style="max-width:200px;">
    `);
  } catch (err) {
    console.error("Error inesperado:", err);
    return res.status(500).send("Error interno del servidor");
  }
});
const PORT = process.env.PORT || 4000;

// ---------------------------
//  SUPABASE CLIENT
// ---------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = "imagenes-bonaparte"; // tu bucket en Supabase Storage

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------
//  CONFIG EXPRESS
// ---------------------------
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PUBLIC_DIR = __dirname;

// Sesiones simples en memoria
const sesiones = {};

// ---------------------------
//  MULTER: memoria para subir a Supabase Storage
// ---------------------------
const upload = multer({
  storage: multer.memoryStorage(),
});

// ---------------------------
//  HELPERS DE MAPEO (DB <-> FRONT)
// ---------------------------
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

// ---------------------------
//  AUTENTICACIÓN
// ---------------------------
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token || !sesiones[token]) {
    return res.status(401).json({ error: "No autorizado" });
  }
  req.user = sesiones[token];
  next();
}

// ---------------------------
//  LOGIN
// ---------------------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};

  const { data, error } = await supabase
    .from("usuarios")
    .select("*")
    .eq("email", email)
    .eq("password", password)
    .single();

  if (error || !data) {
    return res.status(401).json({ error: "Credenciales incorrectas" });
  }

  const token = Date.now() + "-" + data.id;
  sesiones[token] = { userId: data.id, nombre: data.nombre, rol: data.rol };

  res.json({ token, nombre: data.nombre, rol: data.rol });
});

// ---------------------------
//  PEDIDOS
// ---------------------------

// GET todos los pedidos
app.get("/api/pedidos", auth, async (req, res) => {
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

// POST crear pedido
app.post("/api/pedidos", auth, async (req, res) => {
  const body = req.body || {};

  // Obtener último id para sugerir folio
  const { data: maxID, error: maxError } = await supabase
    .from("pedidos")
    .select("id")
    .order("id", { ascending: false })
    .limit(1);

  if (maxError) {
    console.error("Error obteniendo max id:", maxError);
  }

  const nuevoID = maxID?.[0]?.id ? maxID[0].id + 1 : 1;
  const folio = body.folio || "BONA-" + (1000 + nuevoID);

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
    .single();

  if (error) {
    console.error("Error creando pedido:", error);
    return res.status(500).json({ error: "Error al crear pedido" });
  }

  res.status(201).json(mapPedidoFromDb(data));
});

// PUT actualizar pedido
app.put("/api/pedidos/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};

  // Traer el original
  const { data: existingData, error: existingError } = await supabase
    .from("pedidos")
    .select("*")
    .eq("id", id)
    .single();

  if (existingError || !existingData) {
    console.error("Error consultando pedido:", existingError);
    return res.status(404).json({ error: "Pedido no encontrado" });
  }

  const original = mapPedidoFromDb(existingData);

  // Merge: si no viene en body, se deja lo original
  const merged = {
    folio: body.folio ?? original.folio,
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
    precioTotal:
      body.precioTotal != null
        ? Number(body.precioTotal)
        : original.precioTotal,
    anticipo:
      body.anticipo != null ? Number(body.anticipo) : original.anticipo,
    saldo: body.saldo != null ? Number(body.saldo) : original.saldo,
    gastosCompras:
      body.gastosCompras != null
        ? Number(body.gastosCompras)
        : original.gastosCompras,
    condicionesCliente:
      body.condicionesCliente ?? original.condicionesCliente,
    comprasDetalle: body.comprasDetalle ?? original.comprasDetalle,
    imagenUrl: body.imagenUrl ?? original.imagenUrl,
  };

  const payload = mapPedidoToDb(merged, {
    actualizado_en: new Date().toISOString(),
  });

  const { data, error } = await supabase
    .from("pedidos")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("Error actualizando pedido:", error);
    return res.status(500).json({ error: "Error al actualizar pedido" });
  }

  res.json(mapPedidoFromDb(data));
});

// DELETE pedido
app.delete("/api/pedidos/:id", auth, async (req, res) => {
  const id = Number(req.params.id);

  await supabase.from("imagenes").delete().eq("pedido_id", id);

  const { error } = await supabase.from("pedidos").delete().eq("id", id);
  if (error) {
    console.error("Error eliminando pedido:", error);
    return res.status(500).json({ error: "Error al eliminar pedido" });
  }

  res.json({ ok: true });
});

// ---------------------------
//  IMÁGENES (STORAGE)
// ---------------------------

// Subir imagen de pedido a Supabase Storage
app.post(
  "/api/pedidos/:id/imagen",
  auth,
  upload.single("imagen"),
  async (req, res) => {
    const id = Number(req.params.id);

    if (!req.file) {
      return res.status(400).json({ error: "No se recibió imagen" });
    }

    const ext = path.extname(req.file.originalname) || ".jpg";
    const filename = `pedido-${id}-${Date.now()}${ext}`;
    const filePath = `pedidos/${id}/${filename}`;

    // Subir a Storage
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("Error subiendo a Storage:", uploadError);
      return res.status(500).json({ error: "Error al subir imagen" });
    }

    // Obtener URL pública
    const { data: publicData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = publicData.publicUrl;

    // Guardar en tabla imagenes
    const { error: imgError } = await supabase.from("imagenes").insert({
      pedido_id: id,
      imagen_url: publicUrl,
    });

    if (imgError) {
      console.error("Error guardando imagen en tabla:", imgError);
    }

    // Si el pedido no tiene imagen principal, actualizamos
    const { error: updError } = await supabase
      .from("pedidos")
      .update({
        imagen_url: publicUrl,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", id);

    if (updError) {
      console.error("Error actualizando pedido con imagen:", updError);
    }

    res.status(201).json({ url: publicUrl });
  }
);

// Listar imágenes de un pedido
app.get("/api/pedidos/:id/imagenes", auth, async (req, res) => {
  const id = Number(req.params.id);

  const { data, error } = await supabase
    .from("imagenes")
    .select("*")
    .eq("pedido_id", id)
    .order("id", { ascending: true });

  if (error) {
    console.error("Error obteniendo imágenes:", error);
    return res.status(500).json({ error: "Error al obtener imágenes" });
  }

  const mapped = data.map(mapImagenFromDb);
  res.json(mapped);
});

// ---------------------------
//  USUARIOS
// ---------------------------
app.get("/api/users", auth, async (req, res) => {
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

app.post("/api/users", auth, async (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }

  const { nombre, email, password, rol } = req.body || {};

  const { data, error } = await supabase
    .from("usuarios")
    .insert({ nombre, email, password, rol })
    .select("id, nombre, email, rol")
    .single();

  if (error) {
    console.error("Error creando usuario:", error);
    return res.status(500).json({ error: "Error al crear usuario" });
  }

  res.status(201).json(data);
});

app.delete("/api/users/:id", auth, async (req, res) => {
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

// ---------------------------
//  RESPALDO
// ---------------------------
app.get("/api/respaldo", auth, async (req, res) => {
  if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "Solo admin" });
  }

  const [pedidosRes, usuariosRes, imagenesRes] = await Promise.all([
    supabase.from("pedidos").select("*"),
    supabase.from("usuarios").select("id, nombre, email, rol"),
    supabase.from("imagenes").select("*"),
  ]);

  if (pedidosRes.error || usuariosRes.error || imagenesRes.error) {
    console.error("Error en respaldo:", {
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

// ---------------------------
//  FRONTEND
// ---------------------------
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "app-uniformes-multi.html"));
});

// ---------------------------
//  SERVIDOR
// ---------------------------
app.listen(PORT, () => {
  console.log("====================================");
  console.log("   SERVIDOR BONAPARTE ENCENDIDO");
  console.log("   PUERTO:", PORT);
  console.log("====================================");
});
