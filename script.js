// Referencias al DOM respetando los nombres exactos del boceto
const zonaDeChat = document.getElementById("zona-de-chat");
const zonaDeEscritura = document.getElementById("zona-de-escritura");
const campoMensaje = document.getElementById("campo-mensaje");
const botonEnviar = document.getElementById("boton-enviar");

// Variables de control de sesión y flujo
let sessionIdMemoria = null;
let ultimoEnvioTimestamp = 0;
const LIMITE_CARACTERES = 500;
const PAUSA_MINIMA_MS = 1500;
const TIMEOUT_MS = 30000;

/**
 * Obtiene o genera un identificador único de sesión y lo persiste de forma segura.
 */
function obtenerSessionId() {
  const claveStorage = "ia_nutricion_session_id";

  try {
    const idGuardado = localStorage.getItem(claveStorage);
    if (idGuardado) {
      return idGuardado;
    }
  } catch (error) {
    // Si localStorage no está disponible, continuamos con respaldo en memoria
  }

  if (sessionIdMemoria) {
    return sessionIdMemoria;
  }

  const nuevoId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  sessionIdMemoria = nuevoId;

  try {
    localStorage.setItem(claveStorage, nuevoId);
  } catch (error) {
    // Ignoramos error de almacenamiento y mantenemos el ID en memoria
  }

  return nuevoId;
}

// Inicializamos el sessionId una sola vez al cargar la aplicación
const sessionId = obtenerSessionId();

/**
 * Agrega una burbuja de mensaje en la zona de chat usando exclusivamente textContent.
 */
function agregarBurbuja(texto, tipo, esError = false) {
  const burbuja = document.createElement("div");
  burbuja.classList.add("mensaje");
  burbuja.classList.add(tipo === "usuario" ? "mensaje-usuario" : "mensaje-agente");

  if (esError) {
    burbuja.classList.add("mensaje-error");
  }

  const parrafo = document.createElement("p");
  parrafo.classList.add("texto-mensaje");
  parrafo.textContent = texto;

  burbuja.appendChild(parrafo);
  zonaDeChat.appendChild(burbuja);
  zonaDeChat.scrollTop = zonaDeChat.scrollHeight;

  return burbuja;
}

/**
 * Crea y muestra el indicador temporal de carga en la zona de chat.
 */
function mostrarEstadoCargando() {
  const burbujaCargando = agregarBurbuja("Pensando receta o dieta...", "agente");
  burbujaCargando.classList.add("mensaje-cargando");
  return burbujaCargando;
}

/**
 * Habilita o deshabilita los controles de la zona de escritura.
 */
function alternarControles(deshabilitar) {
  campoMensaje.disabled = deshabilitar;
  botonEnviar.disabled = deshabilitar;
}

/**
 * Procesa el texto devuelto por Make según las reglas de extracción definidas.
 */
function procesarTextoRespuesta(textoCrudo) {
  if (!textoCrudo || textoCrudo.trim() === "") {
    return "(respuesta vacía)";
  }

  try {
    const datos = JSON.parse(textoCrudo);

    if (datos !== null && typeof datos === "object" && !Array.isArray(datos)) {
      const clavesPrioridad = ["response", "respuesta", "message", "mensaje"];

      for (const clave of clavesPrioridad) {
        if (typeof datos[clave] === "string" && datos[clave].trim() !== "") {
          return datos[clave];
        }
      }

      return "Make respondió, pero sin el campo response";
    }

    return textoCrudo;
  } catch (error) {
    // Si no es JSON válido, devolvemos el texto literal recibido
    return textoCrudo;
  }
}

/**
 * Realiza la petición POST al Webhook de Make con control de tiempo límite.
 */
async function consultarAgente(mensajeUsuario) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  const cuerpoPeticion = JSON.stringify({
    sessionId: sessionId,
    mensaje: mensajeUsuario,
    fecha: new Date().toISOString()
  });

  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: cuerpoPeticion,
      signal: controlador.signal
    });

    const textoRespuesta = await respuesta.text();

    if (!respuesta.ok) {
      return {
        exito: false,
        texto: `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`
      };
    }

    return {
      exito: true,
      texto: procesarTextoRespuesta(textoRespuesta)
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return {
        exito: false,
        texto: "Se agotó el tiempo de espera (30 segundos). Intentá nuevamente."
      };
    }

    return {
      exito: false,
      texto: "Error de red al intentar conectar con el agente. Revisá tu conexión."
    };
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Maneja el envío del formulario de la zona de escritura.
 */
async function manejarEnvio(evento) {
  evento.preventDefault();

  const textoIngresado = campoMensaje.value.trim();

  // Validación de contenido y longitud máxima
  if (!textoIngresado) {
    return;
  }

  if (textoIngresado.length > LIMITE_CARACTERES) {
    agregarBurbuja(`El mensaje supera el máximo de ${LIMITE_CARACTERES} caracteres.`, "agente", true);
    return;
  }

  // Control de pausa mínima de 1,5 segundos entre envíos consecutivos
  const ahora = Date.now();
  if (ahora - ultimoEnvioTimestamp < PAUSA_MINIMA_MS) {
    return;
  }

  // Validación de configuración del Webhook
  if (typeof WEBHOOK_URL === "undefined" || !WEBHOOK_URL.trim() || WEBHOOK_URL.includes("ACA VA")) {
    agregarBurbuja(textoIngresado, "usuario");
    campoMensaje.value = "";
    agregarBurbuja("Falta pegar la URL de tu webhook en config.js", "agente", true);
    return;
  }

  ultimoEnvioTimestamp = ahora;
  agregarBurbuja(textoIngresado, "usuario");
  campoMensaje.value = "";

  alternarControles(true);
  const burbujaCargando = mostrarEstadoCargando();

  try {
    const resultado = await consultarAgente(textoIngresado);
    burbujaCargando.remove();
    agregarBurbuja(resultado.texto, "agente", !resultado.exito);
  } catch (error) {
    burbujaCargando.remove();
    agregarBurbuja("Ocurrió un error inesperado al procesar la consulta.", "agente", true);
  } finally {
    alternarControles(false);
    campoMensaje.focus();
  }
}

zonaDeEscritura.addEventListener("submit", manejarEnvio);
