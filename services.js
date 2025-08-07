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
    console.log(`===== INICIO: Obteniendo recibo de Loyverse por ID: ${receiptId} =====`);
    
    // Validar token
    if (!token || typeof token !== 'string' || token.trim() === '') {
      console.error('Token de API inválido o vacío');
      throw new Error('Token de API de Loyverse inválido o vacío');
    }
    
    // Validar que el ID del recibo sea una cadena no vacía
    if (!receiptId || typeof receiptId !== 'string' || receiptId.trim() === '') {
      console.error('ID de recibo inválido:', receiptId);
      throw new Error(`ID de recibo inválido o vacío: ${receiptId}`);
    }
    
    // Normalizar el ID del recibo (eliminar espacios y convertir a minúsculas)
    const normalizedReceiptId = receiptId.toString().trim().toLowerCase();
    console.log(`ID de recibo normalizado: ${normalizedReceiptId}`);
    
    // Realizar la solicitud a la API de Loyverse
    console.log(`Realizando solicitud a: https://api.loyverse.com/v1.0/receipts/${normalizedReceiptId}`);
    console.log(`Usando token: ${token.substring(0, 5)}...${token.substring(token.length - 5)}`);
    
    const response = await axios.get(`https://api.loyverse.com/v1.0/receipts/${normalizedReceiptId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000 // 15 segundos de timeout (aumentado para evitar problemas de red)
    });

    // Registrar la respuesta para depuración
    console.log('Respuesta de Loyverse - Status:', response.status);
    console.log('Respuesta de Loyverse - Headers:', JSON.stringify(response.headers, null, 2));
    
    // Verificar si la respuesta es válida
    if (!response.data) {
      console.error('Respuesta de API sin datos');
      return null;
    }
    
    // Registrar estructura de la respuesta para depuración
    console.log('Estructura de la respuesta:', Object.keys(response.data));
    console.log('Muestra de datos:', JSON.stringify(response.data).substring(0, 500) + '...');
    
    let receipt = null;

    // Estrategia 1: Verificar si la respuesta contiene directamente el recibo
    if (response.data.id && response.data.id.toString().toLowerCase() === normalizedReceiptId) {
      console.log('Recibo encontrado directamente en la respuesta');
      receipt = response.data;
    }
    // Estrategia 2: Verificar si el recibo está dentro de un objeto 'receipt'
    else if (response.data.receipt && response.data.receipt.id && 
        response.data.receipt.id.toString().toLowerCase() === normalizedReceiptId) {
      console.log('Recibo encontrado dentro del objeto receipt');
      receipt = response.data.receipt;
    }
    // Estrategia 3: Verificar si hay un array de recibos
    else if (Array.isArray(response.data.receipts)) {
      console.log(`Buscando recibo en array de ${response.data.receipts.length} elementos`);
      
      // Buscar por ID exacto (insensible a mayúsculas/minúsculas)
      const foundReceipt = response.data.receipts.find(r => 
        r.id && r.id.toString().toLowerCase() === normalizedReceiptId);
      
      if (foundReceipt) {
        console.log('Recibo encontrado en el array de recibos');
        receipt = foundReceipt;
      }
    }
    // Estrategia 4: Intentar extraer cualquier objeto que parezca un recibo
    else {
      for (const key in response.data) {
        if (typeof response.data[key] === 'object' && response.data[key] !== null) {
          const obj = response.data[key];
          if (obj.id && obj.id.toString().toLowerCase() === normalizedReceiptId) {
            console.log(`Recibo encontrado en propiedad: ${key}`);
            receipt = obj;
            break;
          }
        }
      }
    }
    
    // Estrategia 5: Buscar en cualquier estructura anidada (búsqueda recursiva)
    if (!receipt) {
      console.log('Intentando búsqueda recursiva en la respuesta...');
      receipt = findReceiptRecursively(response.data, normalizedReceiptId);
      if (receipt) {
        console.log('Recibo encontrado mediante búsqueda recursiva');
      }
    }
    
    // Si no se encontró el recibo, intentar con endpoint alternativo
    if (!receipt) {
      console.log('Recibo no encontrado en respuesta directa, intentando endpoint alternativo...');
      try {
        // Intentar obtener recibos recientes y filtrar por ID
        const altResponse = await axios.get(`https://api.loyverse.com/v1.0/receipts`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          params: {
            created_at_min: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 días atrás
            limit: 250 // Obtener más recibos para aumentar probabilidad de encontrarlo
          },
          timeout: 15000
        });
        
        console.log(`Buscando recibo en lista de ${altResponse.data.receipts?.length || 0} recibos recientes...`);
        
        if (Array.isArray(altResponse.data.receipts)) {
          const foundReceipt = altResponse.data.receipts.find(r => 
            r.id && r.id.toString().toLowerCase() === normalizedReceiptId);
          
          if (foundReceipt) {
            console.log('Recibo encontrado en lista de recibos recientes');
            receipt = foundReceipt;
          }
        }
      } catch (altError) {
        console.error('Error en búsqueda alternativa:', altError.message);
      }
    }
    
    // Si no se encontró el recibo, registrar error y retornar null
    if (!receipt) {
      console.error(`No se encontró el recibo con ID: ${receiptId} en la respuesta de la API`);
      console.error('Datos de respuesta:', JSON.stringify(response.data, null, 2));
      return null;
    }
    
    // Validar estructura mínima del recibo para integración con SRI
    if (!receipt.id || !receipt.receipt_number) {
      console.error('El recibo no tiene la estructura mínima requerida (id o receipt_number):', receipt);
      return null;
    }
    
    // Validar que el recibo tenga líneas de items
    if (!receipt.line_items || !Array.isArray(receipt.line_items) || receipt.line_items.length === 0) {
      console.error('El recibo no tiene líneas de items:', receipt);
      return null;
    }
    
    console.log(`Recibo encontrado con ${receipt.line_items.length} items:`, {
      id: receipt.id,
      receipt_number: receipt.receipt_number,
      created_at: receipt.created_at,
      customer_id: receipt.customer_id || 'Sin cliente asociado',
      total: receipt.total
    });
    
    console.log(`===== FIN: Recibo de Loyverse obtenido exitosamente =====`);
    return receipt;
  } catch (error) {
    console.error('===== ERROR: Obteniendo recibo de Loyverse por ID =====');
    console.error('Detalles del error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      stack: error.stack
    });
    
    // Si es un error de autorización, agregar información adicional
    if (error.response?.status === 401) {
      console.error('Error de autorización: El token de API de Loyverse es inválido o ha expirado');
    }
    // Si es un error 404, el recibo no existe
    else if (error.response?.status === 404) {
      console.error(`El recibo con ID ${receiptId} no existe en Loyverse`);
    }
    // Si es un error de timeout
    else if (error.code === 'ECONNABORTED') {
      console.error('Timeout al conectar con la API de Loyverse');
    }
    
    throw new Error(`Error obteniendo recibo de Loyverse por ID ${receiptId}: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Función auxiliar para buscar un recibo recursivamente en una estructura de datos
 * @param {Object|Array} data - Datos donde buscar
 * @param {string} receiptId - ID del recibo a buscar (normalizado)
 * @returns {Object|null} - Recibo encontrado o null
 */
function findReceiptRecursively(data, receiptId) {
  // Caso base: si data no es un objeto o array, retornar null
  if (!data || typeof data !== 'object') {
    return null;
  }
  
  // Si es un array, buscar en cada elemento
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findReceiptRecursively(item, receiptId);
      if (found) return found;
    }
    return null;
  }
  
  // Si es un objeto que parece un recibo, verificar
  if (data.id && data.id.toString().toLowerCase() === receiptId && 
      (data.receipt_number || data.line_items)) {
    return data;
  }
  
  // Buscar recursivamente en todas las propiedades
  for (const key in data) {
    if (typeof data[key] === 'object' && data[key] !== null) {
      const found = findReceiptRecursively(data[key], receiptId);
      if (found) return found;
    }
  }
  
  return null;
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
    console.log('Iniciando proceso de creación de factura en SRI para recibo:', receipt.id);
    
    // Validar que el recibo tenga la estructura mínima necesaria
    if (!receipt || !receipt.id || !receipt.line_items || !Array.isArray(receipt.line_items)) {
      console.error('Estructura de recibo inválida:', JSON.stringify(receipt, null, 2));
      throw new Error('El recibo no tiene la estructura requerida para procesar en SRI');
    }
    
    console.log(`Recibo validado con ${receipt.line_items.length} items`);
    
    // Obtener datos completos del cliente si existe customer_id
    let customerData = {};
    if (receipt.customer_id && token) {
      console.log(`Obteniendo datos del cliente con ID: ${receipt.customer_id}`);
      try {
        customerData = await getLoyverseCustomer(token, receipt.customer_id);
        console.log('Datos del cliente obtenidos:', JSON.stringify(customerData, null, 2));
      } catch (customerError) {
        console.warn(`Error obteniendo datos del cliente: ${customerError.message}. Continuando sin datos de cliente.`);
      }
    } else {
      console.log('El recibo no tiene customer_id asociado, se usará consumidor final');
    }
    
    // Convertir recibo de Loyverse al formato para SRI
    console.log('Convirtiendo recibo al formato SRI...');
    const facturaData = formatReceiptForSRI(receipt, customerData);
    console.log('Datos de factura formateados para SRI:', JSON.stringify(facturaData, null, 2));
    
    // Generar XML según esquema XSD del SRI
    console.log('Generando XML según esquema XSD del SRI...');
    const xmlContent = generarXmlFactura(facturaData);
    console.log(`XML generado con longitud: ${xmlContent.length} caracteres`);
    
    // Configuración del certificado digital
    const certificatePassword = process.env.CERTIFICADO_CLAVE;
    if (!certificatePassword) {
      throw new Error('No se ha configurado la clave del certificado digital (CERTIFICADO_CLAVE)');
    }
    
    const ambiente = process.env.SRI_AMBIENTE || "1";
    console.log(`Ambiente SRI configurado: ${ambiente === "1" ? "PRUEBAS" : "PRODUCCIÓN"}`);
    
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
    console.log('Procesando comprobante (firma, envío y autorización)...');
    const resultado = await procesarComprobante(xmlContent, certPath, certificatePassword, ambiente, usarBase64);
    console.log('Resultado del procesamiento:', JSON.stringify(resultado, null, 2));
    
    // Guardar el XML firmado y autorizado si fue exitoso
    if (resultado.success) {
      console.log(`Procesamiento exitoso. Clave de acceso: ${resultado.claveAcceso}, Estado: ${resultado.estado}`);
      const directorioXml = path.join(__dirname, 'comprobantes');
      
      // Crear directorio si no existe
      if (!fs.existsSync(directorioXml)) {
        fs.mkdirSync(directorioXml, { recursive: true });
        console.log(`Directorio de comprobantes creado: ${directorioXml}`);
      }
      
      // Guardar XML firmado y autorizado
      const directorioEstado = path.join(directorioXml, resultado.estado.toLowerCase());
      if (!fs.existsSync(directorioEstado)) {
        fs.mkdirSync(directorioEstado, { recursive: true });
        console.log(`Directorio de estado creado: ${directorioEstado}`);
      }
      
      const archivoXml = path.join(directorioEstado, `${resultado.claveAcceso}.xml`);
      fs.writeFileSync(archivoXml, resultado.xmlAutorizado || resultado.xmlFirmado);
      
      console.log(`XML guardado en: ${archivoXml}`);
    } else {
      console.error('El procesamiento no fue exitoso:', resultado.message || 'Sin mensaje de error');
    }
    
    return resultado;
  } catch (error) {
    console.error('Error creando factura en SRI:', error);
    console.error('Detalles del error:', {
      message: error.message,
      stack: error.stack
    });
    
    // Devolver un objeto de error estructurado
    return {
      success: false,
      message: `Error creando factura en SRI: ${error.message}`,
      error: error.message,
      estado: 'ERROR'
    };
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
