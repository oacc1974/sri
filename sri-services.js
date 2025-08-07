/**
 * Módulo para interactuar con los servicios web SOAP del SRI Ecuador
 * Implementa los servicios de recepción y autorización de comprobantes electrónicos
 * @see https://www.sri.gob.ec/facturacion-electronica
 */
const soap = require('soap');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const moment = require('moment');
const logger = require('./logger');

// URLs de los servicios web del SRI
const SRI_URLS = {
  // Ambiente de pruebas
  '1': {
    recepcion: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl',
    autorizacion: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl'
  },
  // Ambiente de producción
  '2': {
    recepcion: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl',
    autorizacion: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl'
  }
};

/**
 * Envía un comprobante electrónico al servicio de recepción del SRI con reintentos
 * @param {string} xmlSignedContent - Contenido del XML firmado
 * @param {string} ambiente - Ambiente SRI ('1' para pruebas, '2' para producción)
 * @param {number} maxReintentos - Número máximo de reintentos (por defecto 3)
 * @param {number} tiempoEsperaMs - Tiempo de espera entre reintentos en ms (por defecto 3000)
 * @returns {Promise<Object>} - Respuesta del servicio de recepción
 */
async function enviarComprobante(xmlSignedContent, ambiente, maxReintentos = 3, tiempoEsperaMs = 3000) {
  // Extraer clave de acceso del XML para los logs
  let claveAcceso = 'desconocida';
  try {
    const match = xmlSignedContent.match(/<claveAcceso>([^<]+)<\/claveAcceso>/);
    if (match && match[1]) {
      claveAcceso = match[1];
    }
  } catch (e) {
    // Ignorar errores al extraer la clave
  }
  
  // Validar ambiente
  if (!['1', '2'].includes(ambiente)) {
    const errorMsg = 'Ambiente inválido. Debe ser "1" (pruebas) o "2" (producción)';
    logger.error(`SRI: RECEPCION - Error de validación: ${errorMsg}`, { claveAcceso });
    throw new Error(errorMsg);
  }
  
  let intento = 0;
  let ultimoError = null;
  
  logger.info(`SRI: RECEPCION - Iniciando envío de comprobante`, {
    claveAcceso,
    ambiente,
    maxReintentos,
    tiempoEsperaMs
  });
  
  while (intento < maxReintentos) {
    try {
      intento++;
      logger.debug(`SRI: RECEPCION - Intento ${intento}/${maxReintentos} de envío al SRI...`, { claveAcceso });
      
      // Crear cliente SOAP para el servicio de recepción
      const client = await soap.createClientAsync(SRI_URLS[ambiente].recepcion, {
        disableCache: true,
        forceSoap12Headers: false,
        timeout: 30000 // 30 segundos de timeout
      });
      
      // Preparar parámetros para el servicio
      const params = {
        xml: xmlSignedContent
      };
      
      // Llamar al método validarComprobante
      const [result] = await client.validarComprobanteAsync(params);
      
      // Registrar la respuesta
      const estado = result.RespuestaRecepcionComprobante?.estado || 'Sin estado';
      logger.info(`SRI: RECEPCION - Respuesta: ${estado}`, { claveAcceso, resultado: result });
      
      // Si hay errores en la respuesta, lanzar excepción para reintentar
      if (result.RespuestaRecepcionComprobante?.comprobantes?.comprobante?.[0]?.mensajes) {
        const mensajes = result.RespuestaRecepcionComprobante.comprobantes.comprobante[0].mensajes;
        if (mensajes.mensaje && mensajes.mensaje.length > 0) {
          const errores = mensajes.mensaje
            .map(m => `${m.identificador}: ${m.mensaje} - ${m.informacionAdicional || ''}`)
            .join('; ');
          
          logger.warning(`SRI: RECEPCION - Errores en la respuesta: ${errores}`, { 
            claveAcceso, 
            mensajes: mensajes.mensaje 
          });
          
          // Si es un error de conexión o timeout, reintentar
          if (errores.includes('TIMEOUT') || errores.includes('CONEXION') || errores.includes('SERVICIO')) {
            throw new Error(`Error temporal del SRI: ${errores}`);
          }
        }
      }
      
      // Registrar éxito en la transacción
      logger.transaccionSRI('RECEPCION', claveAcceso, result, true);
      
      return result;
    } catch (error) {
      ultimoError = error;
      logger.warning(`SRI: RECEPCION - Error en intento ${intento}/${maxReintentos}`, {
        claveAcceso,
        error: error.message,
        intento,
        maxReintentos
      });
      
      // Si ya alcanzamos el máximo de reintentos, lanzar el error
      if (intento >= maxReintentos) {
        break;
      }
      
      // Esperar antes de reintentar
      logger.debug(`SRI: RECEPCION - Esperando ${tiempoEsperaMs/1000} segundos antes de reintentar...`, { claveAcceso });
      await new Promise(resolve => setTimeout(resolve, tiempoEsperaMs));
    }
  }
  
  // Registrar error en la transacción
  logger.errorSRI('RECEPCION', claveAcceso, ultimoError);
  
  throw new Error(`Error al enviar comprobante al SRI después de ${maxReintentos} intentos: ${ultimoError.message}`);
}

/**
 * Consulta el estado de autorización de un comprobante en el SRI con reintentos
 * @param {string} claveAcceso - Clave de acceso del comprobante
 * @param {string} ambiente - Ambiente SRI ('1' para pruebas, '2' para producción)
 * @param {number} maxReintentos - Número máximo de reintentos (por defecto 5)
 * @param {number} tiempoEsperaMs - Tiempo de espera entre reintentos en ms (por defecto 3000)
 * @returns {Promise<Object>} - Respuesta del servicio de autorización
 */
async function consultarAutorizacion(claveAcceso, ambiente, maxReintentos = 5, tiempoEsperaMs = 3000) {
  // Validar ambiente
  if (!['1', '2'].includes(ambiente)) {
    const errorMsg = 'Ambiente inválido. Debe ser "1" (pruebas) o "2" (producción)';
    logger.error(`SRI: AUTORIZACION - Error de validación: ${errorMsg}`, { claveAcceso });
    throw new Error(errorMsg);
  }
  
  // Validar clave de acceso
  if (!claveAcceso || claveAcceso.length !== 49) {
    const errorMsg = `Clave de acceso inválida: ${claveAcceso}. Debe tener 49 dígitos.`;
    logger.error(`SRI: AUTORIZACION - Error de validación: ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  let intento = 0;
  let ultimoError = null;
  
  logger.info(`SRI: AUTORIZACION - Iniciando consulta de autorización`, {
    claveAcceso,
    ambiente,
    maxReintentos,
    tiempoEsperaMs
  });
  
  while (intento < maxReintentos) {
    try {
      intento++;
      logger.debug(`SRI: AUTORIZACION - Intento ${intento}/${maxReintentos} de consulta al SRI...`, { claveAcceso });
      
      // Crear cliente SOAP para el servicio de autorización
      const client = await soap.createClientAsync(SRI_URLS[ambiente].autorizacion, {
        disableCache: true,
        forceSoap12Headers: false,
        timeout: 30000 // 30 segundos de timeout
      });
      
      // Preparar parámetros para el servicio
      const params = {
        claveAccesoComprobante: claveAcceso
      };
      
      // Llamar al método autorizacionComprobante
      const [result] = await client.autorizacionComprobanteAsync(params);
      
      // Registrar la respuesta
      logger.debug(`SRI: AUTORIZACION - Respuesta recibida para clave ${claveAcceso.substring(0, 10)}...${claveAcceso.substring(40)}`);
      
      // Verificar si hay autorizaciones
      const autorizaciones = result.RespuestaAutorizacionComprobante?.autorizaciones;
      if (autorizaciones && autorizaciones.autorizacion && autorizaciones.autorizacion.length > 0) {
        const estado = autorizaciones.autorizacion[0].estado;
        logger.info(`SRI: AUTORIZACION - Estado: ${estado}`, { claveAcceso, estado });
        
        // Si está en proceso, esperar y reintentar
        if (estado === 'EN PROCESO') {
          if (intento < maxReintentos) {
            logger.debug(`SRI: AUTORIZACION - Comprobante en proceso, esperando ${tiempoEsperaMs/1000} segundos antes de reintentar...`, { claveAcceso });
            await new Promise(resolve => setTimeout(resolve, tiempoEsperaMs));
            continue;
          }
        }
        
        // Registrar éxito o rechazo según el estado
        const exito = estado === 'AUTORIZADO';
        logger.transaccionSRI('AUTORIZACION', claveAcceso, {
          estado,
          numeroAutorizacion: autorizaciones.autorizacion[0].numeroAutorizacion,
          fechaAutorizacion: autorizaciones.autorizacion[0].fechaAutorizacion
        }, exito);
      } else {
        logger.warning(`SRI: AUTORIZACION - No se encontraron autorizaciones`, { claveAcceso, resultado: result });
      }
      
      return result;
    } catch (error) {
      ultimoError = error;
      logger.warning(`SRI: AUTORIZACION - Error en intento ${intento}/${maxReintentos}`, {
        claveAcceso,
        error: error.message,
        intento,
        maxReintentos
      });
      
      // Si ya alcanzamos el máximo de reintentos, lanzar el error
      if (intento >= maxReintentos) {
        break;
      }
      
      // Esperar antes de reintentar
      logger.debug(`SRI: AUTORIZACION - Esperando ${tiempoEsperaMs/1000} segundos antes de reintentar...`, { claveAcceso });
      await new Promise(resolve => setTimeout(resolve, tiempoEsperaMs));
    }
  }
  
  // Registrar error en la transacción
  logger.errorSRI('AUTORIZACION', claveAcceso, ultimoError);
  
  throw new Error(`Error al consultar autorización en el SRI después de ${maxReintentos} intentos: ${ultimoError.message}`);
}

/**
 * Guarda un comprobante XML en el sistema de archivos
 * @param {string} xmlContent - Contenido del XML
 * @param {string} claveAcceso - Clave de acceso del comprobante
 * @param {string} estado - Estado del comprobante (RECIBIDO, AUTORIZADO, RECHAZADO)
 * @returns {Promise<string>} - Ruta donde se guardó el archivo
 */
async function guardarComprobanteXml(xmlContent, claveAcceso, estado) {
  try {
    // Crear directorio para comprobantes si no existe
    const dirBase = path.join(process.cwd(), 'comprobantes');
    if (!fs.existsSync(dirBase)) {
      fs.mkdirSync(dirBase, { recursive: true });
    }
    
    // Crear directorio para el estado si no existe
    const dirEstado = path.join(dirBase, estado.toLowerCase());
    if (!fs.existsSync(dirEstado)) {
      fs.mkdirSync(dirEstado, { recursive: true });
    }
    
    // Generar nombre de archivo con fecha
    const fecha = moment().format('YYYYMMDD-HHmmss');
    const filePath = path.join(dirEstado, `${claveAcceso}_${fecha}.xml`);
    
    // Guardar el archivo
    fs.writeFileSync(filePath, xmlContent, 'utf8');
    
    logger.info(`XML guardado: ${estado.toUpperCase()}`, { 
      claveAcceso, 
      estado, 
      ruta: filePath 
    });
    
    return filePath;
  } catch (error) {
    logger.error(`Error al guardar XML: ${estado.toUpperCase()}`, { 
      claveAcceso, 
      estado, 
      error: error.message 
    });
    throw new Error(`Error al guardar comprobante XML: ${error.message}`);
  }
}

/**
 * Proceso completo de envío y autorización de un comprobante
 * @param {string} xmlContent - Contenido del XML sin firmar
 * @param {string} certificatePath - Ruta al certificado .p12 o 'CERT_P12_BASE64' si se usa variable de entorno
 * @param {string} certificatePassword - Contraseña del certificado
 * @param {string} ambiente - Ambiente SRI ('1' para pruebas, '2' para producción)
 * @param {boolean} usarBase64 - Si se debe usar la variable de entorno CERT_P12_BASE64 en lugar de un archivo
 * @param {Object} options - Opciones adicionales
 * @param {number} options.maxReintentos - Número máximo de reintentos (por defecto 3)
 * @param {number} options.tiempoEsperaMs - Tiempo de espera entre reintentos en ms (por defecto 3000)
 * @param {boolean} options.guardarXml - Si se debe guardar el XML en el sistema de archivos (por defecto true)
 * @returns {Promise<Object>} - Resultado del proceso completo
 */
async function procesarComprobante(xmlContent, certificatePath, certificatePassword, ambiente, usarBase64 = false, options = {}) {
  const {
    maxReintentos = 3,
    tiempoEsperaMs = 3000,
    guardarXml = true
  } = options;
  
  let xmlSigned = null;
  let claveAcceso = null;
  
  try {
    // Extraer la clave de acceso del XML
    const claveAccesoMatch = xmlContent.match(/<claveAcceso>([^<]+)<\/claveAcceso>/);
    if (!claveAccesoMatch) {
      throw new Error('No se pudo extraer la clave de acceso del XML');
    }
    claveAcceso = claveAccesoMatch[1];
    
    // Importar el módulo de firma
    const { signXml, verificarCertificado } = require('./xml-signer');
    
    // Verificar el certificado
    let verificacion;
    if (usarBase64) {
      logger.info('Verificando certificado desde variable de entorno base64');
      verificacion = verificarCertificado('CERT_P12_BASE64', certificatePassword, true);
    } else {
      logger.info(`Verificando certificado desde archivo: ${certificatePath}`);
      verificacion = verificarCertificado(certificatePath, certificatePassword);
    }
    
    if (!verificacion.valido) {
      return {
        success: false,
        stage: 'certificado',
        message: `Certificado no válido: ${verificacion.razon}`,
        claveAcceso
      };
    }
    
    // Firmar el XML
    logger.info(`Firmando el XML para comprobante con clave: ${claveAcceso.substring(0, 10)}...${claveAcceso.substring(40)}`);
    xmlSigned = await signXml(xmlContent, certificatePath, certificatePassword, usarBase64);
    
    // Guardar el XML firmado si está habilitado
    if (guardarXml) {
      await guardarComprobanteXml(xmlSigned, claveAcceso, 'FIRMADO');
    }
    
    // Enviar al servicio de recepción
    console.log('Enviando comprobante al SRI...');
    const recepcionResult = await enviarComprobante(xmlSigned, ambiente, maxReintentos, tiempoEsperaMs);
    
    // Verificar si fue recibido correctamente
    if (recepcionResult.RespuestaRecepcionComprobante.estado !== 'RECIBIDA') {
      // Guardar el XML con estado de rechazo si está habilitado
      if (guardarXml) {
        await guardarComprobanteXml(xmlSigned, claveAcceso, 'RECHAZADO');
      }
      
      return {
        success: false,
        stage: 'recepcion',
        message: 'El comprobante no fue recibido correctamente',
        details: recepcionResult,
        claveAcceso
      };
    }
    
    // Guardar el XML recibido si está habilitado
    if (guardarXml) {
      await guardarComprobanteXml(xmlSigned, claveAcceso, 'RECIBIDO');
    }
    
    // Esperar un momento antes de consultar la autorización
    console.log(`Esperando ${tiempoEsperaMs/1000} segundos antes de consultar autorización...`);
    await new Promise(resolve => setTimeout(resolve, tiempoEsperaMs));
    
    // Consultar autorización
    console.log('Consultando autorización del comprobante...');
    const autorizacionResult = await consultarAutorizacion(claveAcceso, ambiente, maxReintentos, tiempoEsperaMs);
    
    // Verificar resultado de autorización
    const respuesta = autorizacionResult.RespuestaAutorizacionComprobante;
    const autorizaciones = respuesta?.autorizaciones;
    
    if (!autorizaciones || !autorizaciones.autorizacion || autorizaciones.autorizacion.length === 0) {
      return {
        success: false,
        stage: 'autorizacion',
        message: 'No se encontraron autorizaciones para el comprobante',
        details: autorizacionResult,
        claveAcceso
      };
    }
    
    const autorizacion = autorizaciones.autorizacion[0];
    const estado = autorizacion.estado;
    
    // Guardar el XML con el estado final si está habilitado
    if (guardarXml) {
      await guardarComprobanteXml(
        autorizacion.comprobante || xmlSigned, 
        claveAcceso, 
        estado === 'AUTORIZADO' ? 'AUTORIZADO' : 'RECHAZADO'
      );
    }
    
    // Construir respuesta
    const mensajes = [];
    if (autorizacion.mensajes && autorizacion.mensajes.mensaje) {
      if (Array.isArray(autorizacion.mensajes.mensaje)) {
        autorizacion.mensajes.mensaje.forEach(m => {
          mensajes.push({
            identificador: m.identificador,
            mensaje: m.mensaje,
            informacionAdicional: m.informacionAdicional
          });
        });
      } else {
        mensajes.push({
          identificador: autorizacion.mensajes.mensaje.identificador,
          mensaje: autorizacion.mensajes.mensaje.mensaje,
          informacionAdicional: autorizacion.mensajes.mensaje.informacionAdicional
        });
      }
    }
    
    return {
      success: estado === 'AUTORIZADO',
      stage: 'autorizacion',
      message: estado === 'AUTORIZADO' ? 'Comprobante autorizado correctamente' : `Comprobante no autorizado: ${estado}`,
      estado,
      numeroAutorizacion: autorizacion.numeroAutorizacion,
      fechaAutorizacion: autorizacion.fechaAutorizacion,
      mensajes,
      claveAcceso
    };
  } catch (error) {
    console.error('Error en el proceso de comprobante:', error);
    
    // Intentar guardar el XML con estado de error si está habilitado
    if (guardarXml && xmlSigned && claveAcceso) {
      try {
        await guardarComprobanteXml(xmlSigned, claveAcceso, 'ERROR');
      } catch (saveError) {
        console.error('Error al guardar XML con estado de error:', saveError);
      }
    }
    
    return {
      success: false,
      stage: 'proceso',
      message: `Error en el proceso: ${error.message}`,
      error: error.toString(),
      claveAcceso
    };
  }
}

/**
 * Verifica el estado de un comprobante por su clave de acceso
 * @param {string} claveAcceso - Clave de acceso del comprobante
 * @param {string} ambiente - Ambiente SRI ('1' para pruebas, '2' para producción)
 * @returns {Promise<Object>} - Estado del comprobante
 */
async function verificarEstadoComprobante(claveAcceso, ambiente) {
  try {
    const autorizacionResult = await consultarAutorizacion(claveAcceso, ambiente, 2, 2000);
    
    const respuesta = autorizacionResult.RespuestaAutorizacionComprobante;
    const autorizaciones = respuesta?.autorizaciones;
    
    if (!autorizaciones || !autorizaciones.autorizacion || autorizaciones.autorizacion.length === 0) {
      return {
        success: false,
        encontrado: false,
        message: 'No se encontró el comprobante',
        claveAcceso
      };
    }
    
    const autorizacion = autorizaciones.autorizacion[0];
    const estado = autorizacion.estado;
    
    return {
      success: true,
      encontrado: true,
      estado,
      autorizado: estado === 'AUTORIZADO',
      numeroAutorizacion: autorizacion.numeroAutorizacion,
      fechaAutorizacion: autorizacion.fechaAutorizacion,
      claveAcceso
    };
  } catch (error) {
    return {
      success: false,
      encontrado: false,
      message: `Error al verificar estado: ${error.message}`,
      claveAcceso
    };
  }
}

module.exports = {
  enviarComprobante,
  consultarAutorizacion,
  procesarComprobante,
  guardarComprobanteXml,
  verificarEstadoComprobante
};
