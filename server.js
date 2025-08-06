require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const cron = require('node-cron');

// Crear directorios necesarios si no existen
const directorios = ['certificados', 'comprobantes', 'logs', 'comprobantes/recibidos', 'comprobantes/autorizados'];
directorios.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Directorio creado: ${dirPath}`);
  }
});
const { 
  getLoyverseReceipts, 
  getLoyverseCustomer, 
  createSRIInvoice,
  verificarEstadoComprobante 
} = require('./services');
const logger = require('./logger');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuración para servir archivos estáticos del directorio public
app.use(express.static(path.join(__dirname, 'public')));

// Variables para almacenar el token y el estado
let loyverseToken = '';
let lastSyncTime = null;
let isProcessing = false;

// Crear directorio para comprobantes si no existe
const comprobantesDir = path.join(__dirname, 'comprobantes');
if (!fs.existsSync(comprobantesDir)) {
  fs.mkdirSync(comprobantesDir, { recursive: true });
}

// Rutas API
app.post('/api/set-token', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: 'Token es requerido' });
  }
  
  loyverseToken = token;
  // Reiniciar el tiempo de sincronización cuando se establece un nuevo token
  lastSyncTime = new Date().toISOString();
  
  res.json({ success: true, message: 'Token guardado correctamente' });
});

app.get('/api/status', (req, res) => {
  // Verificar si existe el certificado digital
  const certificadoPath = process.env.CERTIFICADO_PATH;
  const certificadoExiste = fs.existsSync(certificadoPath);
  
  res.json({
    tokenSet: !!loyverseToken,
    lastSyncTime,
    isProcessing,
    certificadoExiste,
    ambiente: process.env.SRI_AMBIENTE || "1",
    integracionDirecta: true
  });
});

// Ruta para sincronización manual
app.post('/api/sync', async (req, res) => {
  if (!loyverseToken) {
    return res.status(400).json({ success: false, message: 'Token de Loyverse no configurado' });
  }

  if (isProcessing) {
    return res.status(400).json({ success: false, message: 'Ya hay una sincronización en proceso' });
  }
  
  // Verificar si existe el certificado digital
  const certificadoPath = process.env.CERTIFICADO_PATH;
  if (!fs.existsSync(certificadoPath)) {
    return res.status(400).json({ 
      success: false, 
      message: `Certificado digital no encontrado en: ${certificadoPath}` 
    });
  }

  try {
    isProcessing = true;
    const result = await syncLoyverseToSRI();
    isProcessing = false;
    res.json({ success: true, ...result });
  } catch (error) {
    isProcessing = false;
    console.error('Error en sincronización manual:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error en la sincronización', 
      error: error.message 
    });
  }
});

// Ruta para verificar estado de un comprobante
app.get('/api/comprobante/:claveAcceso', async (req, res) => {
  try {
    const { claveAcceso } = req.params;
    
    if (!claveAcceso || claveAcceso.length !== 49) {
      return res.status(400).json({ 
        success: false, 
        message: 'Clave de acceso inválida. Debe tener 49 dígitos.' 
      });
    }
    
    logger.info(`Verificando estado de comprobante`, { claveAcceso });
    const resultado = await verificarEstadoComprobante(claveAcceso);
    res.json({ success: true, resultado });
  } catch (error) {
    logger.error('Error verificando estado del comprobante', { 
      claveAcceso: req.params.claveAcceso, 
      error: error.message 
    });
    res.status(500).json({ 
      success: false, 
      message: 'Error verificando estado del comprobante', 
      error: error.message 
    });
  }
});

// Ruta para verificar el certificado digital
app.get('/api/certificado/verificar', async (req, res) => {
  try {
    const certificadoPath = process.env.CERTIFICADO_PATH;
    const certificadoClave = process.env.CERTIFICADO_CLAVE;
    
    if (!certificadoPath) {
      return res.status(400).json({ 
        success: false, 
        message: 'No se ha configurado la ruta del certificado digital (CERTIFICADO_PATH)' 
      });
    }
    
    // Verificar que el archivo exista
    const certificadoFullPath = path.join(process.cwd(), certificadoPath);
    if (!fs.existsSync(certificadoFullPath)) {
      return res.status(404).json({ 
        success: false, 
        message: `El archivo del certificado no existe en la ruta: ${certificadoFullPath}` 
      });
    }
    
    // Intentar extraer información del certificado
    const { verificarCertificado } = require('./xml-signer');
    const infoCertificado = await verificarCertificado(certificadoFullPath, certificadoClave);
    
    logger.info('Certificado digital verificado correctamente', { infoCertificado });
    
    res.json({ 
      success: true, 
      mensaje: 'Certificado digital válido', 
      certificado: infoCertificado 
    });
  } catch (error) {
    logger.error('Error verificando certificado digital', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Error verificando certificado digital', 
      error: error.message 
    });
  }
});

// Ruta para generar y procesar una factura de prueba
app.post('/api/factura', async (req, res) => {
  try {
    const datosFactura = req.body;
    
    // Validar datos mínimos requeridos
    if (!datosFactura || !datosFactura.cliente || !datosFactura.factura) {
      return res.status(400).json({
        success: false,
        message: 'Datos de factura incompletos. Se requiere información del cliente y de la factura.'
      });
    }
    
    logger.info('Iniciando generación de factura de prueba', { datosFactura });
    
    // Generar XML
    const { generateXml } = require('./xml-generator');
    const xmlContent = await generateXml(datosFactura);
    
    // Firmar XML
    const { signXml } = require('./xml-signer');
    const certificadoPath = path.join(process.cwd(), process.env.CERTIFICADO_PATH);
    const certificadoClave = process.env.CERTIFICADO_CLAVE;
    const xmlSigned = await signXml(xmlContent, certificadoPath, certificadoClave);
    
    // Procesar comprobante (enviar, autorizar y guardar)
    const { procesarComprobante } = require('./sri-services');
    const ambiente = process.env.SRI_AMBIENTE;
    const resultado = await procesarComprobante(xmlSigned, ambiente);
    
    logger.info('Factura de prueba procesada correctamente', { resultado });
    
    res.json({
      success: true,
      mensaje: 'Factura procesada correctamente',
      resultado
    });
  } catch (error) {
    logger.error('Error procesando factura de prueba', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: `Error procesando factura: ${error.message}`
    });
  }
});

// Ruta para obtener lista de comprobantes generados
app.get('/api/comprobantes', (req, res) => {
  try {
    const { estado } = req.query; // Filtro opcional por estado
    const comprobantesDir = path.join(__dirname, 'comprobantes');
    
    if (!fs.existsSync(comprobantesDir)) {
      return res.json({ success: true, comprobantes: [] });
    }
    
    // Obtener todos los subdirectorios (estados)
    const estados = fs.readdirSync(comprobantesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    let comprobantes = [];
    
    // Si se especifica un estado, solo buscar en ese directorio
    if (estado && estados.includes(estado.toLowerCase())) {
      const estadoDir = path.join(comprobantesDir, estado.toLowerCase());
      if (fs.existsSync(estadoDir)) {
        const archivos = fs.readdirSync(estadoDir);
        const comprobantesEstado = archivos
          .filter(archivo => archivo.endsWith('.xml'))
          .map(archivo => {
            const match = archivo.match(/^(\d{49})/);
            const claveAcceso = match ? match[1] : archivo.split('_')[0];
            return {
              claveAcceso,
              estado: estado.toUpperCase(),
              archivo,
              ruta: path.join(estadoDir, archivo),
              fecha: fs.statSync(path.join(estadoDir, archivo)).mtime
            };
          });
        comprobantes = comprobantesEstado;
      }
    } else {
      // Si no se especifica estado, buscar en todos los directorios
      estados.forEach(estado => {
        const estadoDir = path.join(comprobantesDir, estado);
        if (fs.existsSync(estadoDir)) {
          const archivos = fs.readdirSync(estadoDir);
          const comprobantesEstado = archivos
            .filter(archivo => archivo.endsWith('.xml'))
            .map(archivo => {
              const match = archivo.match(/^(\d{49})/);
              const claveAcceso = match ? match[1] : archivo.split('_')[0];
              return {
                claveAcceso,
                estado: estado.toUpperCase(),
                archivo,
                ruta: path.join(estadoDir, archivo),
                fecha: fs.statSync(path.join(estadoDir, archivo)).mtime
              };
            });
          comprobantes = comprobantes.concat(comprobantesEstado);
        }
      });
      
      // También buscar en el directorio raíz (para compatibilidad con versiones anteriores)
      const archivosRaiz = fs.readdirSync(comprobantesDir)
        .filter(archivo => archivo.endsWith('.xml') && archivo.length >= 49);
      
      if (archivosRaiz.length > 0) {
        const comprobantesRaiz = archivosRaiz.map(archivo => {
          const claveAcceso = archivo.replace('.xml', '');
          return {
            claveAcceso,
            estado: 'LEGACY',
            archivo,
            ruta: path.join(comprobantesDir, archivo),
            fecha: fs.statSync(path.join(comprobantesDir, archivo)).mtime
          };
        });
        comprobantes = comprobantes.concat(comprobantesRaiz);
      }
    }
    
    // Ordenar por fecha descendente (más recientes primero)
    comprobantes.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    
    // Agregar estadísticas
    const estadisticas = {};
    estados.forEach(estado => {
      const estadoDir = path.join(comprobantesDir, estado);
      if (fs.existsSync(estadoDir)) {
        const count = fs.readdirSync(estadoDir).filter(archivo => archivo.endsWith('.xml')).length;
        estadisticas[estado.toUpperCase()] = count;
      } else {
        estadisticas[estado.toUpperCase()] = 0;
      }
    });
    
    res.json({ 
      success: true, 
      comprobantes,
      total: comprobantes.length,
      estadisticas
    });
  } catch (error) {
    console.error('Error obteniendo comprobantes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error obteniendo comprobantes', 
      error: error.message 
    });
  }
});

// Ruta para descargar un comprobante XML
app.get('/api/comprobantes/download/:claveAcceso', (req, res) => {
  try {
    const { claveAcceso } = req.params;
    
    if (!claveAcceso || claveAcceso.length !== 49) {
      return res.status(400).json({ 
        success: false, 
        message: 'Clave de acceso inválida. Debe tener 49 dígitos.' 
      });
    }
    
    // Buscar el archivo en todos los directorios de estado
    const comprobantesDir = path.join(__dirname, 'comprobantes');
    let archivoEncontrado = null;
    
    // Verificar primero en el directorio raíz (compatibilidad)
    const archivoRaiz = path.join(comprobantesDir, `${claveAcceso}.xml`);
    if (fs.existsSync(archivoRaiz)) {
      archivoEncontrado = archivoRaiz;
    } else {
      // Buscar en subdirectorios de estado
      const estados = fs.readdirSync(comprobantesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const estado of estados) {
        const estadoDir = path.join(comprobantesDir, estado);
        const archivos = fs.readdirSync(estadoDir);
        
        const archivoMatch = archivos.find(archivo => 
          archivo.startsWith(claveAcceso) && archivo.endsWith('.xml')
        );
        
        if (archivoMatch) {
          archivoEncontrado = path.join(estadoDir, archivoMatch);
          break;
        }
      }
    }
    
    if (!archivoEncontrado) {
      return res.status(404).json({ 
        success: false, 
        message: `No se encontró el comprobante con clave de acceso: ${claveAcceso}` 
      });
    }
    
    // Enviar el archivo como descarga
    res.download(archivoEncontrado, `comprobante_${claveAcceso}.xml`);
  } catch (error) {
    console.error('Error descargando comprobante:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error descargando comprobante', 
      error: error.message 
    });
  }
});

// Función para sincronizar Loyverse con SRI
async function syncLoyverseToSRI() {
  if (!loyverseToken) {
    console.log('Token de Loyverse no configurado');
    return { processed: 0, errors: 0, message: 'Token no configurado' };
  }

  try {
    // Verificar si existe el certificado digital
    const certificadoPath = process.env.CERTIFICADO_PATH;
    if (!fs.existsSync(certificadoPath)) {
      throw new Error(`Certificado digital no encontrado en: ${certificadoPath}`);
    }
    
    // Obtener recibos desde la última sincronización
    const startTime = lastSyncTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const receipts = await getLoyverseReceipts(loyverseToken, startTime);
    
    console.log(`Obtenidos ${receipts.length} recibos de Loyverse`);
    
    let processed = 0;
    let errors = 0;
    let autorizados = 0;
    let rechazados = 0;
    const resultados = [];
    
    // Procesar cada recibo y crear factura en SRI
    for (const receipt of receipts) {
      try {
        // Pasar el token de Loyverse para obtener datos completos del cliente
        const resultado = await createSRIInvoice(receipt, loyverseToken);
        
        // Registrar resultado
        resultados.push({
          receipt: receipt.receipt_number,
          success: resultado.success,
          message: resultado.message,
          claveAcceso: resultado.claveAcceso
        });
        
        if (resultado.success) {
          autorizados++;
        } else {
          rechazados++;
        }
        
        processed++;
      } catch (error) {
        console.error(`Error procesando recibo ${receipt.receipt_number}:`, error);
        resultados.push({
          receipt: receipt.receipt_number,
          success: false,
          message: error.message
        });
        errors++;
      }
    }
    
    // Actualizar tiempo de última sincronización
    lastSyncTime = new Date().toISOString();
    
    return {
      processed,
      errors,
      autorizados,
      rechazados,
      resultados,
      message: `Sincronización completada: ${processed} procesados, ${autorizados} autorizados, ${rechazados} rechazados, ${errors} errores`
    };
  } catch (error) {
    console.error('Error en sincronización:', error);
    throw error;
  }
}

// Programar sincronización automática cada 15 minutos
cron.schedule('*/15 * * * *', async () => {
  console.log('Ejecutando sincronización programada...');
  if (!isProcessing) {
    try {
      isProcessing = true;
      const result = await syncLoyverseToSRI();
      console.log('Resultado de sincronización programada:', result);
    } catch (error) {
      console.error('Error en sincronización programada:', error);
    } finally {
      isProcessing = false;
    }
  } else {
    console.log('Omitiendo sincronización programada: ya hay una en proceso');
  }
});

// Endpoints para acceder a los logs
app.get('/api/logs', (req, res) => {
  try {
    const { fecha, tipo } = req.query;
    const logs = logger.obtenerLogs(fecha, tipo || 'all');
    res.json({ success: true, logs });
  } catch (error) {
    logger.error('Error obteniendo logs', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Error obteniendo logs', 
      error: error.message 
    });
  }
});

app.get('/api/logs/fechas', (req, res) => {
  try {
    const fechas = logger.obtenerFechasLogs();
    res.json({ success: true, fechas });
  } catch (error) {
    logger.error('Error obteniendo fechas de logs', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Error obteniendo fechas de logs', 
      error: error.message 
    });
  }
});

// Endpoint para registrar un mensaje de log manualmente
app.post('/api/logs', (req, res) => {
  try {
    const { level, message, data } = req.body;
    
    if (!level || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Se requieren los campos level y message' 
      });
    }
    
    // Registrar el log según el nivel
    switch (level.toUpperCase()) {
      case 'DEBUG':
        logger.debug(message, data);
        break;
      case 'INFO':
        logger.info(message, data);
        break;
      case 'WARNING':
        logger.warning(message, data);
        break;
      case 'ERROR':
        logger.error(message, data);
        break;
      case 'CRITICAL':
        logger.critical(message, data);
        break;
      default:
        logger.info(message, data);
    }
    
    res.json({ 
      success: true, 
      message: 'Log registrado correctamente' 
    });
  } catch (error) {
    logger.error('Error registrando log', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Error registrando log', 
      error: error.message 
    });
  }
});

// Servir la aplicación React en producción
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// Puerto
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Servidor iniciado en puerto ${PORT}`));
