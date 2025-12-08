// =========================
//  UNIFORMES BONAPARTE
//  SERVER.JS CON SUPABASE DB + STORAGE
// =========================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 4000;

// ---------------------------
//  SUPABASE CLIENT
// ---------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = "imagenes-bonaparte"; // <---- TU BUCKET

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------
//  CONFIG
// ---------------------------
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// Sesiones simples
const sesiones = {};

// ---------------------------
//  MULTER - memoria para subir a Supabase
// ---------------------------
const upload = multer({
  storage: multer.memoryStorage(), // NO disco, ahora memoria
});

// ---------------------------
//  AUTENTICACIÓN
// ---------------------------
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token || !sesiones[token]) return res.status(401).json({ error: "No autorizado" });
  req.user = sesiones[token];
  next();
}

// ---------------------------
//  LOGIN
// ---------------------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase
    .from("usuarios")
    .select("*")
    .eq("email", email)
    .eq("password", password)
    .single();

  if (error || !data) return res.status(401).json({ error: "Credenciales incorrectas" });

  const token = Date.now() + "-" + data.id;
  sesiones[token] = { userId: data.id, nombre: data.nombre, rol: data.rol };

  res.json({ token, nombre: data.nombre, rol: data.rol });
});

// ---------------------------
//  GET PEDIDOS
// ---------------------------
app.get("/api/pedidos", auth, async (req, res) => {
  const { data, error } = await supabase.from("pedidos").select("*").order("id", { ascending: false });
  if (error) return res.status(500).json({ error: "Error al obtener pedidos" });
  res.json(data);
});

// ---------------------------
//  CREAR PEDIDO
// ---------------------------
app.post("/api/pedidos", auth, async (req, res) => {
  const body = req.body;

  const { data: maxID } = await supabase
    .from("pedidos")
    .select("id")
    .order("id", { ascending: false })
    .limit(1);

  const nuevoID = maxID?.[0]?.id + 1 || 1;
  const folio = body.folio || "BONA-" + (1000 + nuevoID);

  const { data, error } = await supabase
    .from("pedidos")
    .insert({
      folio,
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
      precio_total: body.precioTotal || 0,
      anticipo: body.anticipo || 0,
      saldo: body.saldo || 0,
      gastos_compras: body.gastosCompras || 0,
      condiciones_cliente: body.condicionesCliente,
      compras_detalle: body.comprasDetalle,
      imagen_url: null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: "Error al crear pedido" });
  res.json(data);
});

// ---------------------------
//  ACTUALIZAR PEDIDO
// ---------------------------
app.put("/api/pedidos/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body;

  const { data, error } = await supabase
    .from("pedidos")
    .update({
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
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: "Error al actualizar pedido" });
  res.json(data);
});

// ---------------------------
//  ELIMINAR PEDIDO
// ---------------------------
app.delete("/api/pedidos/:id", auth, async (req, res) => {
  const id = Number(req.params.id);

  await supabase.from("imagenes").delete().eq("pedido_id", id);
  await supabase.from("pedidos").delete().eq("id", id);

  res.json({ ok: true });
});

// ---------------------------
//  SUBIR IMAGEN A SUPABASE STORAGE
// ---------------------------
app.post("/api/pedidos/:id/imagen", auth, upload.single("imagen"), async (req, res) => {
  const id = Number(req.params.id);

  if (!req.file) return res.status(400).json({ error: "No se recibió imagen" });

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

  if (uploadError) return res.status(500).json({ error: "Error al subir imagen" });

  // Obtener URL pública
  const { data: publicUrl } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath);

  // Guardar en tabla
  await supabase.from("imagenes").insert({
    pedido_id: id,
    imagen_url: publicUrl.publicUrl,
  });

  // Si el pedido no tiene imagen principal, asignarla
  await supabase
    .from("pedidos")
    .update({ imagen_url: publicUrl.publicUrl })
    .eq("id", id);

  res.json({ url: publicUrl.publicUrl });
});

// ---------------------------
//  LISTAR IMÁGENES
// ---------------------------
app.get("/api/pedidos/:id/imagenes", auth, async (req, res) => {
  const id = Number(req.params.id);

  const { data, error } = await supabase
    .from("imagenes")
    .select("*")
    .eq("pedido_id", id);

  if (error) return res.status(500).json({ error: "Error al obtener imágenes" });
  res.json(data);
});

// ---------------------------
//  USUARIOS
// ---------------------------
app.get("/api/users", auth, async (req, res) => {
  if (req.user.rol !== "admin") return res.status(403).json({ error: "Solo admin" });

  const { data } = await supabase.from("usuarios").select("id, nombre, email, rol");
  res.json(data);
});

app.post("/api/users", auth, async (req, res) => {
  if (req.user.rol !== "admin") return res.status(403).json({ error: "Solo admin" });

  const { nombre, email, password, rol } = req.body;

  const { data, error } = await supabase
    .from("usuarios")
    .insert({ nombre, email, password, rol })
    .select()
    .single();

  if (error) return res.status(500).json({ error: "Error creando usuario" });
  res.json(data);
});

app.delete("/api/users/:id", auth, async (req, res) => {
  if (req.user.rol !== "admin") return res.status(403).json({ error: "Solo admin" });

  const id = Number(req.params.id);
  await supabase.from("usuarios").delete().eq("id", id);

  res.json({ ok: true });
});

// ---------------------------
//  FRONTEND
// ---------------------------
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "app-uniformes-multi.html"));
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
