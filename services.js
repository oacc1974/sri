const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Cargar variables de entorno
dotenv.config();

// Importar módulos de integración directa con SRI
const { generarXmlFactura } = require('./xml-generator');
const { procesarComprobante } = require('./sri-services');

/**
 * Obtiene recibos de Loyverse desde una fecha específica
 * @param {string} token - Token de API de Loyverse
 * @param {string} startTime - Fecha ISO desde la cual obtener recibos
 * @returns {Promise<Array>} - Lista de recibos
 */
async function getLoyverseReceipts(token, startTime) {
  try {
    const response = await axios.get('https://api.loyverse.com/v1.0/receipts', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      params: {
        created_at_min: startTime,
        limit: 250 // Máximo permitido por la API
      }
    });

    return response.data.receipts || [];
  } catch (error) {
    console.error('Error obteniendo recibos de Loyverse:', error.response?.data || error.message);
    throw new Error(`Error obteniendo recibos de Loyverse: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Obtiene un recibo específico de Loyverse por su ID
 * @param {string} token - Token de API de Loyverse
 * @param {string} receiptId - ID del recibo
 * @returns {Promise<Object>} - Datos del recibo
 */
async function getLoyverseReceiptById(token, receiptId) {
  try {
    console.log(`Obteniendo recibo de Loyverse por ID: ${receiptId}`);
    const response = await axios.get(`https://api.loyverse.com/v1.0/receipts/${receiptId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Respuesta de Loyverse:', JSON.stringify(response.data, null, 2));

    // La API puede devolver el recibo directamente o dentro de un objeto
    if (response.data) {
      if (response.data.id === receiptId) {
        // Si la API devuelve el recibo directamente
        return response.data;
      } else if (response.data.receipt && response.data.receipt.id === receiptId) {
        // Si la API devuelve el recibo dentro de un objeto 'receipt'
        return response.data.receipt;
      } else if (Array.isArray(response.data.receipts) && response.data.receipts.length > 0) {
        // Si la API devuelve un array de recibos
        const foundReceipt = response.data.receipts.find(r => r.id === receiptId);
        if (foundReceipt) {
          return foundReceipt;
        }
      }
    }
    
    console.log(`No se encontró el recibo con ID: ${receiptId} en la respuesta de la API`);
    return null;
  } catch (error) {
    console.error('Error obteniendo recibo de Loyverse por ID:', error.response?.data || error.message);
    throw new Error(`Error obteniendo recibo de Loyverse por ID: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Obtiene los datos completos de un cliente de Loyverse
 * @param {string} token - Token de API de Loyverse
 * @param {string} customerId - ID del cliente
 * @returns {Promise<Object>} - Datos del cliente
 */
async function getLoyverseCustomer(token, customerId) {
  if (!customerId) return {};
  
  try {
    const response = await axios.get(`https://api.loyverse.com/v1.0/customers/${customerId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data || {};
  } catch (error) {
    console.error('Error obteniendo datos del cliente de Loyverse:', error.response?.data || error.message);
    // No lanzamos error para no interrumpir el flujo, retornamos objeto vacío
    return {};
  }
}

/**
 * Determina el tipo de identificación según el formato del número
 * @param {string} identificacion - Número de identificación
 * @returns {string} - Código del tipo de identificación para SRI
 */
function determinarTipoIdentificacion(identificacion) {
  if (!identificacion || identificacion === "9999999999") {
    return "07"; // Consumidor final
  }
  
  // Limpiar posibles espacios o caracteres no numéricos
  const numeroLimpio = identificacion.replace(/[^0-9]/g, '');
  
  if (numeroLimpio.length === 13) {
    return "04"; // RUC
  } else if (numeroLimpio.length === 10) {
    return "05"; // Cédula
  } else {
    return "06"; // Pasaporte u otro
  }
}

/**
 * Extrae la identificación fiscal del cliente desde el campo customer_code
 * @param {Object} customer - Datos del cliente de Loyverse
 * @returns {string} - Número de identificación extraído
 */
function extraerIdentificacionCliente(customer) {
  if (!customer) return "9999999999";
  
  // Priorizar customer_code como fuente principal de la identificación fiscal
  if (customer.customer_code && customer.customer_code.trim() !== "") {
    // Limpiar el customer_code de caracteres no numéricos
    const identificacionLimpia = customer.customer_code.replace(/[^0-9]/g, '');
    
    // Validar que sea un formato válido de RUC (13 dígitos) o cédula (10 dígitos)
    if (/^\d{10,13}$/.test(identificacionLimpia)) {
      return identificacionLimpia;
    }
  }
  
  // Opción de respaldo: Buscar en note con formato "RUC: XXXX" o "CEDULA: XXXX"
  // Solo se usa si customer_code no contiene una identificación válida
  if (customer.note) {
    // Buscar patrones como "RUC: 1234567890001" o "CEDULA: 1234567890"
    const rucMatch = customer.note.match(/RUC:?\s*(\d{10,13})/i);
    if (rucMatch) return rucMatch[1];
    
    const cedulaMatch = customer.note.match(/CEDULA:?\s*(\d{10})/i);
    if (cedulaMatch) return cedulaMatch[1];
    
    // Buscar cualquier secuencia de 10 o 13 dígitos en las notas
    const numeroMatch = customer.note.match(/(\d{10,13})/);
    if (numeroMatch) return numeroMatch[1];
  }
  
  // Si no se encuentra, retornar consumidor final
  return "9999999999";
}

/**
 * Convierte un recibo de Loyverse al formato requerido por el SRI
 * @param {Object} receipt - Recibo de Loyverse
 * @param {Object} customerData - Datos completos del cliente (opcional)
 * @returns {Object} - Datos formateados para SRI
 */
function formatReceiptForSRI(receipt, customerData = {}) {
  // Usar datos del cliente proporcionados o crear objeto vacío
  const customer = customerData || {};
  
  // Extraer identificación fiscal del cliente
  const identificacion = extraerIdentificacionCliente(customer);
  
  // Determinar tipo de identificación
  const tipoIdentificacion = determinarTipoIdentificacion(identificacion);
  
  // Formatear items
  const items = receipt.line_items.map(item => ({
    cantidad: item.quantity,
    codigoPrincipal: item.sku || item.variant_id || item.item_id,
    descripcion: item.item_name,
    precioUnitario: item.price,
    descuento: (item.total_discount || 0),
    precioTotalSinImpuestos: item.total_money - (item.line_taxes?.[0]?.money_amount || 0),
    impuestos: [{
      codigo: "2", // IVA
      codigoPorcentaje: "2", // 12%
      baseImponible: item.total_money - (item.line_taxes?.[0]?.money_amount || 0),
      valor: item.line_taxes?.[0]?.money_amount || 0
    }]
  }));

  // Obtener datos de la empresa desde variables de entorno
  const empresaRuc = process.env.EMPRESA_RUC || "9999999999001";
  const empresaRazonSocial = process.env.EMPRESA_RAZON_SOCIAL || "EMPRESA DEMO";
  const empresaNombreComercial = process.env.EMPRESA_NOMBRE_COMERCIAL || "EMPRESA DEMO";
  const empresaDireccion = process.env.EMPRESA_DIRECCION || "Dirección de la empresa";
  const empresaEstablecimiento = process.env.EMPRESA_ESTABLECIMIENTO || "001";
  const empresaPuntoEmision = process.env.EMPRESA_PUNTO_EMISION || "001";
  
  // Crear objeto de factura para SRI
  return {
    ambiente: process.env.SRI_AMBIENTE || "1", // 1: Pruebas, 2: Producción
    tipoEmision: "1", // 1: Normal
    razonSocial: empresaRazonSocial,
    nombreComercial: empresaNombreComercial,
    ruc: empresaRuc,
    claveAcceso: "", // Se generará automáticamente
    codigoDocumento: "01", // 01: Factura
    establecimiento: empresaEstablecimiento,
    puntoEmision: empresaPuntoEmision,
    secuencial: receipt.receipt_number.replace(/\D/g, '').padStart(9, '0').substring(0, 9),
    fechaEmision: new Date(receipt.receipt_date || receipt.created_at).toISOString().split('T')[0],
    fechaExpiracion: "", // Opcional
    direccionEstablecimiento: empresaDireccion,
    totalSinImpuestos: receipt.total_money - receipt.total_tax,
    totalDescuento: receipt.total_discount || 0,
    propina: receipt.tip || 0,
    importeTotal: receipt.total_money,
    moneda: "DOLAR",
    cliente: {
      razonSocial: customer.name || "CONSUMIDOR FINAL",
      identificacion: identificacion,
      tipoIdentificacion: tipoIdentificacion,
      direccion: customer.address || "",
      email: customer.email || "",
      telefono: customer.phone_number || ""
    },
    items: items,
    pagos: [
      {
        formaPago: "01", // 01: Sin utilización del sistema financiero
        total: receipt.total_money,
        plazo: "0",
        unidadTiempo: "dias"
      }
    ]
  };
}

/**
 * Crea una factura en el SRI directamente usando los servicios web SOAP
 * @param {Object} receipt - Recibo de Loyverse
 * @param {string} token - Token de API de Loyverse (para obtener datos del cliente)
 * @returns {Promise<Object>} - Respuesta del proceso de facturación electrónica
 */
async function createSRIInvoice(receipt, token) {
  try {
    // Obtener datos completos del cliente si existe customer_id
    let customerData = {};
    if (receipt.customer_id && token) {
      customerData = await getLoyverseCustomer(token, receipt.customer_id);
    }
    
    // Convertir recibo de Loyverse al formato para SRI
    const facturaData = formatReceiptForSRI(receipt, customerData);
    
    // Generar XML según esquema XSD del SRI
    const xmlContent = generarXmlFactura(facturaData);
    
    // Configuración del certificado digital
    const certificatePassword = process.env.CERTIFICADO_CLAVE;
    const ambiente = process.env.SRI_AMBIENTE || "1";
    const certificadoBase64 = process.env.CERT_P12_BASE64;
    const certificatePath = process.env.CERTIFICADO_PATH;
    
    // Determinar si usar certificado base64 o archivo
    let usarBase64 = false;
    let certPath = certificatePath;
    
    if (certificadoBase64) {
      console.log('Usando certificado desde variable de entorno base64 para factura');
      usarBase64 = true;
      certPath = 'CERT_P12_BASE64';
    } else if (certificatePath) {
      // Verificar que existe el certificado
      if (!fs.existsSync(certificatePath)) {
        throw new Error(`Certificado no encontrado en: ${certificatePath}`);
      }
      console.log(`Usando certificado desde archivo: ${certificatePath}`);
    } else {
      throw new Error('No se ha configurado el certificado digital (CERT_P12_BASE64 o CERTIFICADO_PATH)');
    }
    
    // Procesar el comprobante (firmar, enviar y autorizar)
    const resultado = await procesarComprobante(xmlContent, certPath, certificatePassword, ambiente, usarBase64);
    
    // Guardar el XML firmado y autorizado si fue exitoso
    if (resultado.success) {
      const directorioXml = path.join(__dirname, 'comprobantes');
      
      // Crear directorio si no existe
      if (!fs.existsSync(directorioXml)) {
        fs.mkdirSync(directorioXml, { recursive: true });
      }
      
      // Guardar XML firmado y autorizado
      fs.writeFileSync(
        path.join(directorioXml, `${resultado.claveAcceso}.xml`),
        resultado.details.comprobante
      );
    }
    
    console.log(`Factura procesada en SRI para recibo ${receipt.receipt_number}:`, 
      resultado.success ? 'AUTORIZADA' : 'RECHAZADA');
    
    return {
      success: resultado.success,
      message: resultado.message,
      claveAcceso: resultado.claveAcceso,
      autorizacion: resultado.details,
      receipt: receipt.receipt_number
    };
  } catch (error) {
    console.error('Error creando factura en SRI:', error);
    throw new Error(`Error creando factura en SRI: ${error.message}`);
  }
}

/**
 * Verifica el estado de un comprobante en el SRI
 * @param {string} claveAcceso - Clave de acceso del comprobante
 * @returns {Promise<Object>} - Estado del comprobante
 */
async function verificarEstadoComprobante(claveAcceso) {
  try {
    // Validar formato de clave de acceso
    if (!claveAcceso || claveAcceso.length !== 49) {
      throw new Error(`Clave de acceso inválida: ${claveAcceso}. Debe tener 49 dígitos.`);
    }
    
    // Usar la nueva implementación de verificarEstadoComprobante
    const { verificarEstadoComprobante: verificarEstado } = require('./sri-services');
    const ambiente = process.env.SRI_AMBIENTE || "1";
    
    // Llamar a la función con reintentos reducidos para respuesta rápida
    const resultado = await verificarEstado(claveAcceso, ambiente);
    
    // Verificar si existe el archivo XML localmente
    const directorioXml = path.join(__dirname, 'comprobantes');
    const archivoXmlPath = path.join(directorioXml, `${claveAcceso}.xml`);
    const existeLocalmente = fs.existsSync(archivoXmlPath);
    
    // Agregar información adicional al resultado
    return {
      ...resultado,
      existeLocalmente,
      rutaArchivo: existeLocalmente ? archivoXmlPath : null,
      fechaConsulta: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error verificando estado del comprobante:', error);
    throw new Error(`Error verificando estado del comprobante: ${error.message}`);
  }
}

module.exports = {
  getLoyverseReceipts,
  getLoyverseReceiptById,
  getLoyverseCustomer,
  formatReceiptForSRI,
  createSRIInvoice,
  verificarEstadoComprobante,
  extraerIdentificacionCliente,
  determinarTipoIdentificacion
};
