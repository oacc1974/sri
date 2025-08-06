/**
 * Módulo para gestión de logs del sistema de facturación electrónica
 * Permite registrar eventos, errores y transacciones con el SRI
 */
const fs = require('fs');
const path = require('path');
const moment = require('moment');

// Niveles de log
const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

// Colores para consola
const COLORS = {
  DEBUG: '\x1b[36m', // Cyan
  INFO: '\x1b[32m',  // Verde
  WARNING: '\x1b[33m', // Amarillo
  ERROR: '\x1b[31m', // Rojo
  CRITICAL: '\x1b[41m\x1b[37m', // Fondo rojo, texto blanco
  RESET: '\x1b[0m' // Reset
};

// Directorio base para logs
const LOG_DIR = path.join(process.cwd(), 'logs');

// Crear directorio de logs si no existe
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Formatea un mensaje de log
 * @param {string} level - Nivel de log
 * @param {string} message - Mensaje a registrar
 * @param {Object} data - Datos adicionales
 * @returns {string} - Mensaje formateado
 */
function formatLogMessage(level, message, data = null) {
  const timestamp = moment().format('YYYY-MM-DD HH:mm:ss.SSS');
  let logMessage = `[${timestamp}] [${level}] ${message}`;
  
  if (data) {
    if (typeof data === 'object') {
      try {
        // Intentar convertir a JSON, pero manejar errores de circularidad
        const dataStr = JSON.stringify(data, (key, value) => {
          if (key === 'error' && value instanceof Error) {
            return {
              message: value.message,
              stack: value.stack,
              name: value.name
            };
          }
          return value;
        }, 2);
        logMessage += `\nDATA: ${dataStr}`;
      } catch (e) {
        logMessage += `\nDATA: [Error al serializar: ${e.message}]`;
      }
    } else {
      logMessage += `\nDATA: ${data}`;
    }
  }
  
  return logMessage;
}

/**
 * Escribe un mensaje en el archivo de log
 * @param {string} level - Nivel de log
 * @param {string} message - Mensaje a registrar
 * @param {Object} data - Datos adicionales
 */
function writeToLogFile(level, message, data = null) {
  try {
    const today = moment().format('YYYY-MM-DD');
    const logFile = path.join(LOG_DIR, `${today}.log`);
    
    const logMessage = formatLogMessage(level, message, data) + '\n';
    
    // Escribir al archivo de log
    fs.appendFileSync(logFile, logMessage, 'utf8');
    
    // Si es un error o crítico, también escribir a un archivo específico de errores
    if (level === LOG_LEVELS.ERROR || level === LOG_LEVELS.CRITICAL) {
      const errorLogFile = path.join(LOG_DIR, `${today}_errors.log`);
      fs.appendFileSync(errorLogFile, logMessage, 'utf8');
    }
    
    // Si es una transacción SRI, también escribir a un archivo específico
    if (message.includes('SRI:')) {
      const sriLogFile = path.join(LOG_DIR, `${today}_sri.log`);
      fs.appendFileSync(sriLogFile, logMessage, 'utf8');
    }
  } catch (error) {
    console.error(`Error escribiendo al archivo de log: ${error.message}`);
  }
}

/**
 * Registra un mensaje de log
 * @param {string} level - Nivel de log
 * @param {string} message - Mensaje a registrar
 * @param {Object} data - Datos adicionales
 */
function log(level, message, data = null) {
  if (!Object.values(LOG_LEVELS).includes(level)) {
    level = LOG_LEVELS.INFO;
  }
  
  // Formatear mensaje para consola
  const consoleMessage = formatLogMessage(level, message, data);
  
  // Mostrar en consola con colores
  console.log(`${COLORS[level]}${consoleMessage}${COLORS.RESET}`);
  
  // Escribir al archivo de log
  writeToLogFile(level, message, data);
}

/**
 * Registra un mensaje de nivel DEBUG
 * @param {string} message - Mensaje a registrar
 * @param {Object} data - Datos adicionales
 */
function debug(message, data = null) {
  log(LOG_LEVELS.DEBUG, message, data);
}

/**
 * Registra un mensaje de nivel INFO
 * @param {string} message - Mensaje a registrar
 * @param {Object} data - Datos adicionales
 */
function info(message, data = null) {
  log(LOG_LEVELS.INFO, message, data);
}

/**
 * Registra un mensaje de nivel WARNING
 * @param {string} message - Mensaje a registrar
 * @param {Object} data - Datos adicionales
 */
function warning(message, data = null) {
  log(LOG_LEVELS.WARNING, message, data);
}

/**
 * Registra un mensaje de nivel ERROR
 * @param {string} message - Mensaje a registrar
 * @param {Object} data - Datos adicionales
 */
function error(message, data = null) {
  log(LOG_LEVELS.ERROR, message, data);
}

/**
 * Registra un mensaje de nivel CRITICAL
 * @param {string} message - Mensaje a registrar
 * @param {Object} data - Datos adicionales
 */
function critical(message, data = null) {
  log(LOG_LEVELS.CRITICAL, message, data);
}

/**
 * Registra una transacción con el SRI
 * @param {string} tipo - Tipo de transacción (RECEPCION, AUTORIZACION)
 * @param {string} claveAcceso - Clave de acceso del comprobante
 * @param {Object} resultado - Resultado de la transacción
 * @param {boolean} exito - Si la transacción fue exitosa
 */
function transaccionSRI(tipo, claveAcceso, resultado, exito = true) {
  const level = exito ? LOG_LEVELS.INFO : LOG_LEVELS.WARNING;
  const message = `SRI: ${tipo} - Clave: ${claveAcceso.substring(0, 10)}...${claveAcceso.substring(40)} - ${exito ? 'EXITOSO' : 'FALLIDO'}`;
  log(level, message, resultado);
}

/**
 * Registra un error en una transacción con el SRI
 * @param {string} tipo - Tipo de transacción (RECEPCION, AUTORIZACION)
 * @param {string} claveAcceso - Clave de acceso del comprobante
 * @param {Error} error - Error ocurrido
 */
function errorSRI(tipo, claveAcceso, error) {
  const message = `SRI: ${tipo} - Clave: ${claveAcceso ? `${claveAcceso.substring(0, 10)}...${claveAcceso.substring(40)}` : 'N/A'} - ERROR`;
  log(LOG_LEVELS.ERROR, message, { error });
}

/**
 * Obtiene los logs del día actual o de una fecha específica
 * @param {string} fecha - Fecha en formato YYYY-MM-DD (opcional, por defecto hoy)
 * @param {string} tipo - Tipo de log (all, errors, sri)
 * @returns {string} - Contenido del archivo de log
 */
function obtenerLogs(fecha = null, tipo = 'all') {
  try {
    const day = fecha || moment().format('YYYY-MM-DD');
    let logFile;
    
    switch (tipo.toLowerCase()) {
      case 'errors':
        logFile = path.join(LOG_DIR, `${day}_errors.log`);
        break;
      case 'sri':
        logFile = path.join(LOG_DIR, `${day}_sri.log`);
        break;
      default:
        logFile = path.join(LOG_DIR, `${day}.log`);
    }
    
    if (!fs.existsSync(logFile)) {
      return `No hay logs disponibles para ${day} (${tipo})`;
    }
    
    return fs.readFileSync(logFile, 'utf8');
  } catch (error) {
    console.error(`Error leyendo archivo de log: ${error.message}`);
    return `Error leyendo archivo de log: ${error.message}`;
  }
}

/**
 * Obtiene la lista de fechas para las que hay logs disponibles
 * @returns {Array<string>} - Lista de fechas en formato YYYY-MM-DD
 */
function obtenerFechasLogs() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      return [];
    }
    
    const archivos = fs.readdirSync(LOG_DIR);
    const fechas = new Set();
    
    archivos.forEach(archivo => {
      const match = archivo.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
      if (match) {
        fechas.add(match[1]);
      }
    });
    
    return Array.from(fechas).sort().reverse(); // Más recientes primero
  } catch (error) {
    console.error(`Error obteniendo fechas de logs: ${error.message}`);
    return [];
  }
}

module.exports = {
  debug,
  info,
  warning,
  error,
  critical,
  transaccionSRI,
  errorSRI,
  obtenerLogs,
  obtenerFechasLogs,
  LOG_LEVELS
};
