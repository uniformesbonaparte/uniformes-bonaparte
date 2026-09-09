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
const multer = require("multer");
const sharp = require("sharp"); // MEJORA AGREGADA: normaliza cualquier formato de imagen (HEIC, WEBP, PNG, etc.) a JPG antes de guardarla
const heicConvert = require("heic-convert"); // MEJORA AGREGADA: sharp no puede leer HEIC/HEIF (fotos de iPhone) por licencia, este paquete sí puede
const bcrypt = require("bcryptjs"); // MEJORA AGREGADA: cifrado de contraseñas
const { supabase, STORAGE_BUCKET } = require("./supabaseClient");

const app = express();
const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = __dirname;

// ---------------------------
//  CONFIG EXPRESS
// ---------------------------
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// ✅ CAMBIO AQUÍ: Servir archivos estáticos desde la raíz
app.use(express.static(__dirname));

// Sesiones simples en memoria
const sesiones = {};

// MEJORA AGREGADA: limite de intentos de login por correo (anti fuerza bruta)
// Se guarda en memoria: si se reinicia el servidor, el contador se reinicia
// tambien (no es grave, solo protege contra ataques automatizados seguidos).
const intentosLogin = {}; // { email: { intentos, bloqueadoHasta } }
const MAX_INTENTOS_LOGIN = 10;
const VENTANA_BLOQUEO_MS = 15 * 60 * 1000; // 15 minutos

function revisarBloqueoLogin(email) {
  const registro = intentosLogin[email];
  if (!registro) return { bloqueado: false };
  if (registro.bloqueadoHasta && Date.now() < registro.bloqueadoHasta) {
    const minutosRestantes = Math.ceil((registro.bloqueadoHasta - Date.now()) / 60000);
    return { bloqueado: true, minutosRestantes };
  }
  return { bloqueado: false };
}

function registrarIntentoFallido(email) {
  const registro = intentosLogin[email] || { intentos: 0, bloqueadoHasta: null };
  registro.intentos += 1;
  if (registro.intentos >= MAX_INTENTOS_LOGIN) {
    registro.bloqueadoHasta = Date.now() + VENTANA_BLOQUEO_MS;
    registro.intentos = 0;
  }
  intentosLogin[email] = registro;
}

function limpiarIntentosLogin(email) {
  delete intentosLogin[email];
}

// ---------------------------
//  MULTER: memoria para subir a Supabase Storage
// ---------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ---------------------------
//  MEJORA AGREGADA: normalizar cualquier formato de imagen a JPG
//  Antes la imagen se subia "tal cual" (mismo formato y mismo mimetype
//  que mandara el celular). El problema: las fotos de iPhone por default
//  vienen en HEIC/HEIF, y la mayoria de navegadores (Chrome, Firefox,
//  Android) no pueden mostrar ese formato en una etiqueta <img>, aunque
//  la foto SI se haya subido correctamente a Supabase. Por eso "un
//  formato se ve y otro no". Esta funcion convierte SIEMPRE a JPG antes
//  de guardar, sin importar en que formato llegue la foto original.
// ---------------------------
async function normalizarImagenAJpg(buffer, mimetype, originalname) {
  const nombre = (originalname || "").toLowerCase();
  const esHeic =
    /heic|heif/i.test(mimetype || "") || /\.(heic|heif)$/i.test(nombre);

  let bufferTrabajo = buffer;

  if (esHeic) {
    try {
      // sharp no puede decodificar HEIC/HEIF (limitacion de licencia de la
      // libreria que usa por debajo), asi que primero se pasa por
      // heic-convert, que si sabe leer ese formato.
      bufferTrabajo = await heicConvert({
        buffer,
        format: "JPEG",
        quality: 0.9,
      });
    } catch (errHeic) {
      console.error(
        "MEJORA AGREGADA (imagenes): fallo heic-convert, se intenta con sharp de todos modos:",
        errHeic.message
      );
      // se deja bufferTrabajo como el original; el intento con sharp de
      // abajo probablemente tambien falle, y ahi se activa el respaldo
      // final (subir el archivo original sin convertir).
    }
  }

  // Se normaliza con sharp: corrige orientacion (fotos de celular giradas),
  // limita el ancho maximo para que no pesen varios MB innecesariamente,
  // y garantiza que el resultado sea un JPG valido y visible en cualquier
  // navegador.
  const jpgBuffer = await sharp(bufferTrabajo)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return jpgBuffer;
}

// ---------------------------
//  RUTA DE PRUEBA PARA SUBIR UNA IMAGEN
//  POST /test-imagen  (form con campo "imagen")
// ---------------------------
app.post("/test-imagen", upload.single("imagen"), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).send("No se recibió ningún archivo");
  }

  try {
    // MEJORA AGREGADA: misma normalizacion a JPG que en la subida real
    let bufferFinal = file.buffer;
    let mimetypeFinal = file.mimetype;
    let fileExt = file.originalname.split(".").pop();
    try {
      bufferFinal = await normalizarImagenAJpg(
        file.buffer,
        file.mimetype,
        file.originalname
      );
      mimetypeFinal = "image/jpeg";
      fileExt = "jpg";
    } catch (errConv) {
      console.error("MEJORA AGREGADA (imagenes): fallo normalizando en /test-imagen:", errConv.message);
    }

    const fileName = `${Date.now()}_${Math.random()
      .toString(36)
      .substring(2)}.${fileExt}`;
    const filePath = `tests/${fileName}`;

    // 1) Subir al bucket de Supabase
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, bufferFinal, {
        contentType: mimetypeFinal,
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
// Página sencilla para probar subida de imagen (SIN archivo físico)
app.get("/test-imagen", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Test subir imagen a Supabase</title>
    </head>
    <body>
      <h1>Subir imagen de prueba a Supabase</h1>
      <p>
        Selecciona una imagen y envíala. Si todo está bien, verás la URL pública y la imagen
        directamente desde Supabase Storage.
      </p>

      <form action="/test-imagen" method="post" enctype="multipart/form-data">
        <label>
          Elige una imagen:
          <input type="file" name="imagen" accept="image/*" required />
        </label>
        <br /><br />
        <button type="submit">Subir imagen</button>
      </form>
    </body>
    </html>
  `);
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
    descripcionGeneral: row.descripcion_general,
    fechaIngreso: row.fecha_ingreso,
    fechaEntrega: row.fecha_entrega,
    estado: row.estado,
    tallasTexto: row.tallas_texto,
    especificacionesTelas: row.especificaciones_telas,
    corteNotas: row.corte_notas,
    confeccionNotas: row.confeccion_notas,
    precioTotal: Number(row.precio_total || 0),
    anticipo: Number(row.anticipo || 0),
    saldo: Number(row.saldo || 0),
    gastosCompras: Number(row.gastos_compras || 0),
    condicionesCliente: row.condiciones_cliente,
    comprasDetalle: row.compras_detalle,
    imagenUrl: row.imagen_url,
    prendas: row.prendas,
    notas: row.notas,
    // Campos de Corte
    corteTipoTela: row.corte_tipo_tela,
    corteColor: row.corte_color,
    corteCantidadKg: row.corte_cantidad_kg,
    corteCantidadMetros: row.corte_cantidad_metros,
    cortePiezasCortadas: row.corte_piezas_cortadas,
    corteObservaciones: row.corte_observaciones,
    corteUsuario: row.corte_usuario,
    corteFecha: row.corte_fecha,
    // Campos de Confección
    confeccionPiezasRecibidas: row.confeccion_piezas_recibidas,
    confeccionPiezasTerminadas: row.confeccion_piezas_terminadas,
    confeccionAccesorios: row.confeccion_accesorios,
    confeccionObservaciones: row.confeccion_observaciones,
    confeccionUsuario: row.confeccion_usuario,
    confeccionFecha: row.confeccion_fecha,
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
    descripcion_general: body.descripcionGeneral,
    fecha_ingreso: body.fechaIngreso,
    fecha_entrega: body.fechaEntrega,
    estado: body.estado,
    tallas_texto: body.tallasTexto,
    especificaciones_telas: body.especificacionesTelas,
    corte_notas: body.corteNotas,
    confeccion_notas: body.confeccionNotas,
    precio_total: body.precioTotal,
    anticipo: body.anticipo,
    saldo: body.saldo,
    gastos_compras: body.gastosCompras,
    condiciones_cliente: body.condicionesCliente,
    compras_detalle: body.comprasDetalle,
    imagen_url: body.imagenUrl,
    prendas: body.prendas,
    notas: body.notas,
    // Campos de Corte
    corte_tipo_tela: body.corteTipoTela,
    corte_color: body.corteColor,
    corte_cantidad_kg: body.corteCantidadKg,
    corte_cantidad_metros: body.corteCantidadMetros,
    corte_piezas_cortadas: body.cortePiezasCortadas,
    corte_observaciones: body.corteObservaciones,
    corte_usuario: body.corteUsuario,
    corte_fecha: body.corteFecha,
    // Campos de Confección
    confeccion_piezas_recibidas: body.confeccionPiezasRecibidas,
    confeccion_piezas_terminadas: body.confeccionPiezasTerminadas,
    confeccion_accesorios: body.confeccionAccesorios,
    confeccion_observaciones: body.confeccionObservaciones,
    confeccion_usuario: body.confeccionUsuario,
    confeccion_fecha: body.confeccionFecha,
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
//  MEJORA AGREGADA: ocultar dinero en el servidor
//  Las pantallas de Corte y Confección ya NO mostraban precio, anticipo,
//  saldo ni gastos en pantalla, pero el servidor los mandaba igual dentro
//  de la respuesta JSON (visible con las herramientas de desarrollador
//  del navegador). Ahora se quitan esos campos en el servidor mismo para
//  cualquier rol que no sea admin o ventas.
// ---------------------------
const CAMPOS_FINANCIEROS_PEDIDO = [
  "precioTotal",
  "anticipo",
  "saldo",
  "gastosCompras",
  "comprasDetalle",
  "condicionesCliente",
];

function puedeVerDinero(rol) {
  return rol === "admin" || rol === "ventas";
}

function ocultarDineroSiAplica(pedidoMapeado, rol) {
  if (!pedidoMapeado || puedeVerDinero(rol)) return pedidoMapeado;
  const copia = { ...pedidoMapeado };
  for (const campo of CAMPOS_FINANCIEROS_PEDIDO) {
    delete copia[campo];
  }
  return copia;
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

  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña son requeridos" });
  }

  // MEJORA AGREGADA: bloqueo temporal tras varios intentos fallidos seguidos
  const bloqueo = revisarBloqueoLogin(email);
  if (bloqueo.bloqueado) {
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Intenta de nuevo en ${bloqueo.minutosRestantes} minuto(s).`,
    });
  }

  // MEJORA AGREGADA: ya no se filtra por password en la consulta (las
  // contraseñas cifradas con bcrypt son distintas cada vez aunque el texto
  // sea el mismo), se busca solo por email y se compara después.
  const { data, error } = await supabase
    .from("usuarios")
    .select("*")
    .eq("email", email)
    .single();

  if (error || !data) {
    registrarIntentoFallido(email);
    return res.status(401).json({ error: "Credenciales incorrectas" });
  }

  // MEJORA AGREGADA: cifrado de contraseñas con migración automática.
  // Si la contraseña guardada ya está cifrada (empieza con $2a$/$2b$/$2y$)
  // se compara con bcrypt. Si todavía está en texto plano (usuarios
  // antiguos), se compara como antes y, si coincide, se cifra y se guarda
  // de una vez en Supabase para que la próxima vez ya quede protegida.
  // Así no hace falta migrar a todos los usuarios de golpe ni pedirles
  // que cambien su contraseña.
  const yaEstaCifrada = /^\$2[aby]\$/.test(data.password || "");
  let credencialesValidas = false;

  if (yaEstaCifrada) {
    credencialesValidas = await bcrypt.compare(password, data.password);
  } else {
    credencialesValidas = data.password === password;
    if (credencialesValidas) {
      try {
        const hash = await bcrypt.hash(password, 10);
        await supabase.from("usuarios").update({ password: hash }).eq("id", data.id);
      } catch (errHash) {
        console.error("MEJORA AGREGADA (login): no se pudo migrar la contraseña a cifrada:", errHash.message);
        // No bloquea el login si la migración falla, solo se queda sin cifrar por ahora
      }
    }
  }

  if (!credencialesValidas) {
    registrarIntentoFallido(email);
    return res.status(401).json({ error: "Credenciales incorrectas" });
  }

  limpiarIntentosLogin(email);

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

  // MEJORA AGREGADA: no mandar dinero a roles que no deben verlo
  const mapped = data.map((row) => ocultarDineroSiAplica(mapPedidoFromDb(row), req.user?.rol));
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

  // MEJORA AGREGADA: no mandar dinero a roles que no deben verlo
  res.status(201).json(ocultarDineroSiAplica(mapPedidoFromDb(data), req.user?.rol));
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
    descripcionGeneral: body.descripcionGeneral ?? original.descripcionGeneral,
    fechaIngreso: body.fechaIngreso ?? original.fechaIngreso,
    fechaEntrega: body.fechaEntrega ?? original.fechaEntrega,
    estado: body.estado ?? original.estado,
    tallasTexto: body.tallasTexto ?? original.tallasTexto,
    especificacionesTelas: body.especificacionesTelas ?? original.especificacionesTelas,
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
    prendas: body.prendas ?? original.prendas,
    notas: body.notas ?? original.notas,
    // Campos de Corte
    corteTipoTela: body.corteTipoTela ?? original.corteTipoTela,
    corteColor: body.corteColor ?? original.corteColor,
    corteCantidadKg: body.corteCantidadKg ?? original.corteCantidadKg,
    corteCantidadMetros: body.corteCantidadMetros ?? original.corteCantidadMetros,
    cortePiezasCortadas: body.cortePiezasCortadas ?? original.cortePiezasCortadas,
    corteObservaciones: body.corteObservaciones ?? original.corteObservaciones,
    corteUsuario: body.corteUsuario ?? original.corteUsuario,
    corteFecha: body.corteFecha ?? original.corteFecha,
    // Campos de Confección
    confeccionPiezasRecibidas: body.confeccionPiezasRecibidas ?? original.confeccionPiezasRecibidas,
    confeccionPiezasTerminadas: body.confeccionPiezasTerminadas ?? original.confeccionPiezasTerminadas,
    confeccionAccesorios: body.confeccionAccesorios ?? original.confeccionAccesorios,
    confeccionObservaciones: body.confeccionObservaciones ?? original.confeccionObservaciones,
    confeccionUsuario: body.confeccionUsuario ?? original.confeccionUsuario,
    confeccionFecha: body.confeccionFecha ?? original.confeccionFecha,
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

  // ========== REGISTRAR ACTIVIDAD ==========
  // Detectar cambios en prendas (corte o confección)
  try {
    const prendasNuevas = body.prendas ? (typeof body.prendas === 'string' ? JSON.parse(body.prendas) : body.prendas) : null;
    const prendasOriginales = original.prendas ? (typeof original.prendas === 'string' ? JSON.parse(original.prendas) : original.prendas) : null;

    if (prendasNuevas && prendasOriginales) {
      prendasNuevas.forEach((prendaNueva, idx) => {
        const prendaOriginal = prendasOriginales[idx];
        if (!prendaOriginal) return;

        // Detectar si se guardaron datos de corte
        if (prendaNueva.corte_datos && !prendaOriginal.corte_datos) {
          registrarActividad(
            id,
            'corte_guardado',
            prendaNueva.tipoPrenda || 'Prenda',
            req.user?.nombre || 'Usuario',
            { telas: prendaNueva.corte_datos.telas }
          );
        }

        // Detectar si se envió a confección
        if (prendaNueva.estado_prenda === 'en_confeccion' && prendaOriginal.estado_prenda !== 'en_confeccion') {
          registrarActividad(
            id,
            'prenda_enviada_confeccion',
            prendaNueva.tipoPrenda || 'Prenda',
            req.user?.nombre || 'Usuario',
            { piezas_cortadas: prendaNueva.corte_datos?.piezasCortadas }
          );
        }

        // Detectar si se completó en confección
        if (prendaNueva.estado_prenda === 'terminada' && prendaOriginal.estado_prenda !== 'terminada') {
          registrarActividad(
            id,
            'confeccion_terminada',
            prendaNueva.tipoPrenda || 'Prenda',
            req.user?.nombre || 'Usuario',
            { piezas_terminadas: prendaNueva.confeccion_datos?.piezasTerminadas }
          );
        }
      });
    }
  } catch (actividadError) {
    console.error('Error registrando actividad:', actividadError);
    // No bloquear la respuesta si falla el registro de actividad
  }

  // MEJORA AGREGADA: no mandar dinero a roles que no deben verlo
  res.json(ocultarDineroSiAplica(mapPedidoFromDb(data), req.user?.rol));
});

// DELETE pedido
app.delete("/api/pedidos/:id", auth, async (req, res) => {
  const id = Number(req.params.id);

  // MEJORA AGREGADA: antes solo se borraban las filas de la tabla
  // "imagenes", pero los archivos reales seguian ocupando espacio en
  // Supabase Storage para siempre (huerfanos). Ahora se borran tambien
  // los archivos de la carpeta pedidos/{id}/ dentro del bucket.
  try {
    const carpeta = `pedidos/${id}`;
    const { data: archivos, error: errorList } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(carpeta);

    if (errorList) {
      console.error("MEJORA AGREGADA (storage): no se pudo listar archivos a borrar:", errorList.message);
    } else if (archivos && archivos.length > 0) {
      const rutas = archivos.map((archivo) => `${carpeta}/${archivo.name}`);
      const { error: errorRemove } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(rutas);
      if (errorRemove) {
        console.error("MEJORA AGREGADA (storage): no se pudieron borrar los archivos:", errorRemove.message);
      }
    }
  } catch (errStorage) {
    console.error("MEJORA AGREGADA (storage): error inesperado limpiando archivos:", errStorage.message);
    // No se bloquea el borrado del pedido si falla la limpieza de Storage
  }

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

    // MEJORA AGREGADA: normalizar siempre a JPG (arregla fotos HEIC de
    // iPhone y cualquier otro formato que el navegador no pudiera mostrar).
    // Si por algo falla la conversion, se sube el archivo original tal
    // cual llego, para que la subida nunca se rompa por completo.
    let bufferFinal = req.file.buffer;
    let mimetypeFinal = req.file.mimetype;
    let extFinal = path.extname(req.file.originalname) || ".jpg";
    try {
      bufferFinal = await normalizarImagenAJpg(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
      mimetypeFinal = "image/jpeg";
      extFinal = ".jpg";
    } catch (errConv) {
      console.error(
        "MEJORA AGREGADA (imagenes): no se pudo normalizar la imagen, se sube el archivo original:",
        errConv.message
      );
    }

    const filename = `pedido-${id}-${Date.now()}${extFinal}`;
    const filePath = `pedidos/${id}/${filename}`;

    // Subir a Storage
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, bufferFinal, {
        contentType: mimetypeFinal,
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

  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: "Faltan datos del usuario" });
  }

  // MEJORA AGREGADA: los usuarios nuevos se guardan con contraseña ya
  // cifrada desde el inicio, no en texto plano
  const passwordCifrada = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("usuarios")
    .insert({ nombre, email, password: passwordCifrada, rol })
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
// ---------------------------
//  ACTIVIDAD / TIMELINE
// ---------------------------

// GET /api/actividad - Obtener actividad reciente (últimas 24 horas)
// MEJORA AGREGADA: esta ruta no tenía "auth", cualquiera con la URL
// podía ver el historial de actividad sin haber iniciado sesión
app.get("/api/actividad", auth, async (req, res) => {
  try {
    const hace24h = new Date();
    hace24h.setHours(hace24h.getHours() - 24);

    const { data, error } = await supabase
      .from("actividad_pedidos")
      .select(`
        *,
        pedidos:pedido_id (
          folio,
          cliente_nombre
        )
      `)
      .gte("fecha", hace24h.toISOString())
      .order("fecha", { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("Error obteniendo actividad:", err);
    res.status(500).json({ error: "Error al obtener actividad" });
  }
});

// GET /api/pedidos/:id/timeline - Obtener timeline de un pedido específico
// MEJORA AGREGADA: esta ruta no tenía "auth", cualquiera con la URL
// podía ver la línea de tiempo de un pedido sin haber iniciado sesión
app.get("/api/pedidos/:id/timeline", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("actividad_pedidos")
      .select("*")
      .eq("pedido_id", id)
      .order("fecha", { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("Error obteniendo timeline:", err);
    res.status(500).json({ error: "Error al obtener timeline" });
  }
});

// Función helper para registrar actividad
async function registrarActividad(pedidoId, tipo, prendaNombre, usuario, detalles = {}) {
  try {
    const { error } = await supabase
      .from("actividad_pedidos")
      .insert({
        pedido_id: pedidoId,
        tipo: tipo,
        prenda_nombre: prendaNombre,
        usuario: usuario,
        detalles: detalles
      });

    if (error) {
      console.error("Error registrando actividad:", error);
    }
  } catch (err) {
    console.error("Error en registrarActividad:", err);
  }
}

// GET pedido individual por ID
// IMPORTANTE: Este endpoint va después de /api/pedidos/:id/imagenes y /api/pedidos/:id/timeline
// porque en Express las rutas más específicas deben ir primero
app.get("/api/pedidos/:id", auth, async (req, res) => {
  const id = Number(req.params.id);

  const { data, error } = await supabase
    .from("pedidos")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error("Error obteniendo pedido:", error);
    return res.status(404).json({ error: "Pedido no encontrado" });
  }

  // MEJORA AGREGADA: no mandar dinero a roles que no deben verlo
  res.json(ocultarDineroSiAplica(mapPedidoFromDb(data), req.user?.rol));
});

// Ruta principal - App de Admin/Ventas
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "app-uniformes-multi.html"));
});

// Ruta para Área de Corte
app.get("/corte", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "app-corte.html"));
});

// Ruta para Área de Confección
app.get("/confeccion", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "app-confeccion.html"));
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
