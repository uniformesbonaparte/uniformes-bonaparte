// imagenUtils.js
// MEJORA AGREGADA
// Funcion compartida para normalizar cualquier imagen a JPG. La usa
// tanto server.js (para las fotos nuevas que se suban) como
// migrar_imagenes_antiguas.js (para corregir las fotos que ya estaban
// subidas desde antes del arreglo). Vive en un solo lugar para que
// ambos usen exactamente la misma logica.
const sharp = require("sharp");
const heicConvert = require("heic-convert");

// Antes la imagen se subia "tal cual" (mismo formato y mismo mimetype
// que mandara el celular). El problema: las fotos de iPhone por default
// vienen en HEIC/HEIF, y la mayoria de navegadores (Chrome, Firefox,
// Android) no pueden mostrar ese formato en una etiqueta <img>, aunque
// la foto SI se haya subido correctamente a Supabase. Por eso "un
// formato se ve y otro no". Esta funcion convierte SIEMPRE a JPG antes
// de guardar, sin importar en que formato llegue la foto original.
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
      // final (subir el archivo original sin convertir, o marcarlo como
      // error en el script de migracion).
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

module.exports = { normalizarImagenAJpg };
