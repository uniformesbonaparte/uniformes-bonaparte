// migrar_imagenes_antiguas.js
// =========================================================================
// MEJORA AGREGADA — script de reparación de UNA SOLA VEZ
// =========================================================================
// El arreglo de "conversión automática a JPG" solo aplica a fotos NUEVAS
// que se suban desde ahora. Las fotos que ya estaban guardadas en Supabase
// Storage ANTES del arreglo (por ejemplo en HEIC de iPhone) se quedaron
// guardadas tal cual y seguían sin verse. Este script las revisa y las
// corrige, una por una, sin tocar nada de la base de datos ni cambiar
// ningún enlace: el archivo queda en la MISMA ruta/URL de siempre, solo
// que su contenido pasa a ser un JPG válido que cualquier navegador puede
// mostrar.
//
// QUÉ HACE:
//   1. Lee todos los pedidos existentes en la tabla "pedidos".
//   2. Por cada pedido, revisa su carpeta "pedidos/<id>/" dentro del
//      bucket de Storage.
//   3. Descarga cada foto y comprueba si ya es un JPG válido.
//      - Si ya es un JPG válido, no la toca (se deja igual).
//      - Si no (HEIC, WEBP, PNG mal etiquetado, corrupta, etc.), la
//        convierte con la misma función que ya usa la app para las fotos
//        nuevas, y sube el resultado a la MISMA ruta (sin crear archivos
//        duplicados ni cambiar el enlace guardado en la base de datos).
//   4. Al final imprime un resumen: cuántas fotos revisó, cuántas ya
//      estaban bien, cuántas corrigió y cuántas fallaron (con el motivo).
//
// CÓMO CORRERLO (una sola vez, no hace falta dejarlo programado):
//   1. Necesitas las variables de entorno SUPABASE_URL y
//      SUPABASE_SERVICE_ROLE_KEY (las mismas que usa el servidor en Render).
//      Si las tienes en un archivo .env en esta misma carpeta, ya con eso
//      basta.
//   2. Para revisar SIN modificar nada todavía (recomendado primero):
//        node migrar_imagenes_antiguas.js --solo-revisar
//   3. Para corregir de verdad las fotos que lo necesiten:
//        node migrar_imagenes_antiguas.js
//
// Es seguro correrlo más de una vez: las fotos que ya quedaron bien la
// primera vez, la segunda vez se detectan como "ya estaban bien" y no se
// vuelven a tocar.
// =========================================================================

require("dotenv").config();
const sharp = require("sharp");
const { supabase, STORAGE_BUCKET } = require("./supabaseClient");
const { normalizarImagenAJpg } = require("./imagenUtils");

const SOLO_REVISAR = process.argv.includes("--solo-revisar");

async function archivoYaEsJpgValido(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    return meta.format === "jpeg";
  } catch (e) {
    // Si sharp ni siquiera puede leer el archivo, seguro tampoco se ve
    // bien en el navegador.
    return false;
  }
}

async function obtenerTodosLosPedidoIds() {
  const { data, error } = await supabase.from("pedidos").select("id");
  if (error) throw new Error("No se pudo leer la tabla de pedidos: " + error.message);
  return (data || []).map((row) => row.id);
}

async function procesarCarpetaPedido(pedidoId, estadisticas) {
  const carpeta = `pedidos/${pedidoId}`;
  const { data: archivos, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(carpeta, { limit: 1000 });

  if (error) {
    console.error(`  ⚠️  No se pudo revisar la carpeta del pedido ${pedidoId}: ${error.message}`);
    estadisticas.errores++;
    return;
  }

  if (!archivos || archivos.length === 0) return;

  for (const archivo of archivos) {
    const rutaCompleta = `${carpeta}/${archivo.name}`;
    estadisticas.revisadas++;

    try {
      const { data: blob, error: errDescarga } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(rutaCompleta);
      if (errDescarga) throw new Error(errDescarga.message);

      const buffer = Buffer.from(await blob.arrayBuffer());
      const yaEsValida = await archivoYaEsJpgValido(buffer);

      if (yaEsValida) {
        estadisticas.yaEstabanBien++;
        continue;
      }

      const mimetypeGuardado = archivo.metadata?.mimetype || "desconocido";
      console.log(`  🔧 Pedido ${pedidoId} — ${archivo.name} (formato guardado: ${mimetypeGuardado}) necesita conversión`);

      if (SOLO_REVISAR) {
        estadisticas.necesitanConversion++;
        continue;
      }

      const bufferConvertido = await normalizarImagenAJpg(buffer, mimetypeGuardado, archivo.name);

      const { error: errSubida } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(rutaCompleta, bufferConvertido, {
          contentType: "image/jpeg",
          upsert: true, // reemplaza el archivo en la MISMA ruta, mismo enlace de siempre
        });
      if (errSubida) throw new Error(errSubida.message);

      estadisticas.corregidas++;
      console.log(`     ✅ corregida`);
    } catch (err) {
      estadisticas.errores++;
      console.error(`     ❌ error con ${rutaCompleta}: ${err.message}`);
    }
  }
}

async function main() {
  console.log("=================================================================");
  console.log("  REPARACIÓN DE FOTOS ANTIGUAS — Uniformes Bonaparte");
  console.log(SOLO_REVISAR ? "  (modo SOLO REVISAR: no se modifica nada todavía)" : "  (modo REAL: se corregirán las fotos que lo necesiten)");
  console.log("=================================================================\n");

  const pedidoIds = await obtenerTodosLosPedidoIds();
  console.log(`Pedidos encontrados: ${pedidoIds.length}\n`);

  const estadisticas = {
    revisadas: 0,
    yaEstabanBien: 0,
    necesitanConversion: 0,
    corregidas: 0,
    errores: 0,
  };

  for (const id of pedidoIds) {
    await procesarCarpetaPedido(id, estadisticas);
  }

  console.log("\n================= RESUMEN =================");
  console.log(`Fotos revisadas:          ${estadisticas.revisadas}`);
  console.log(`Ya estaban bien (JPG):    ${estadisticas.yaEstabanBien}`);
  if (SOLO_REVISAR) {
    console.log(`Necesitan corrección:     ${estadisticas.necesitanConversion}  (vuelve a correr sin --solo-revisar para corregirlas)`);
  } else {
    console.log(`Corregidas ahora:         ${estadisticas.corregidas}`);
  }
  console.log(`Errores:                  ${estadisticas.errores}`);
  console.log("=============================================\n");

  process.exit(estadisticas.errores > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n❌ Error general al correr la migración:", err.message);
  process.exit(1);
});
