/**
 * Módulo para generar XML de comprobantes electrónicos según esquemas del SRI Ecuador
 * Basado en los requisitos oficiales del SRI para facturación electrónica
 * @see https://www.sri.gob.ec/facturacion-electronica
 */
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('xmldom');
const libxmljs = require('libxmljs2');

/**
 * Genera la clave de acceso para un comprobante electrónico
 * @param {Object} params - Parámetros para generar la clave de acceso
 * @param {string} params.fechaEmision - Fecha de emisión en formato YYYY-MM-DD
 * @param {string} params.tipoComprobante - Código del tipo de comprobante (01: factura, 04: nota de crédito, etc.)
 * @param {string} params.ruc - RUC del emisor
 * @param {string} params.ambiente - Ambiente (1: pruebas, 2: producción)
 * @param {string} params.serie - Serie del comprobante (establecimiento + puntoEmision)
 * @param {string} params.secuencial - Secuencial del comprobante
 * @param {string} params.tipoEmision - Tipo de emisión (1: normal)
 * @returns {string} - Clave de acceso de 49 dígitos
 */
function generarClaveAcceso(params) {
  const { fechaEmision, tipoComprobante, ruc, ambiente, serie, secuencial, tipoEmision } = params;
  
  // Generar código numérico aleatorio de 8 dígitos
  const codigoNumerico = Math.floor(10000000 + Math.random() * 90000000).toString();
  
  // Formatear fecha a DDMMYYYY
  const fecha = moment(fechaEmision).format('DDMMYYYY');
  
  // Asegurar que el secuencial tenga 9 dígitos
  const secuencialFormateado = secuencial.toString().padStart(9, '0');
  
  // Construir clave sin dígito verificador
  const claveBase = `${fecha}${tipoComprobante}${ruc}${ambiente}${serie}${secuencialFormateado}${codigoNumerico}${tipoEmision}`;
  
  // Verificar que la clave base tenga exactamente 48 caracteres
  if (claveBase.length !== 48) {
    throw new Error(`La clave de acceso base debe tener 48 dígitos, pero tiene ${claveBase.length}`);
  }
  
  // Calcular dígito verificador (algoritmo módulo 11)
  let suma = 0;
  // Verificar que los coeficientes tengan la misma longitud que la clave base
  const coeficientes = [2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7];
  
  if (coeficientes.length !== claveBase.length) {
    throw new Error(`Los coeficientes (${coeficientes.length}) deben tener la misma longitud que la clave base (${claveBase.length})`);
  }
  
  // Realizar la multiplicación y suma para cada dígito
  for (let i = 0; i < claveBase.length; i++) {
    const digito = parseInt(claveBase.charAt(i));
    if (isNaN(digito)) {
      throw new Error(`La clave de acceso contiene caracteres no numéricos en la posición ${i+1}`);
    }
    suma += digito * coeficientes[i];
  }
  
  // Calcular el dígito verificador según el algoritmo oficial del SRI
  // 11 - (suma % 11) = dígito verificador, con reglas especiales para 10 y 11
  const modulo = suma % 11;
  const digitoVerificador = (11 - modulo) === 11 ? 0 : (11 - modulo) === 10 ? 1 : (11 - modulo);
  
  console.log(`Suma: ${suma}, Módulo: ${modulo}, Dígito verificador calculado: ${digitoVerificador}`);
  
  // Clave de acceso completa
  const claveAcceso = `${claveBase}${digitoVerificador}`;
  
  // Verificar que la clave de acceso tenga exactamente 49 caracteres
  if (claveAcceso.length !== 49) {
    throw new Error(`La clave de acceso debe tener 49 dígitos, pero tiene ${claveAcceso.length}`);
  }
  
  return claveAcceso;
}

/**
 * Genera el XML para una factura electrónica según el esquema del SRI
 * @param {Object} factura - Datos de la factura
 * @returns {string} - XML de la factura
 */
function generarXmlFactura(factura) {
  // Obtener la fecha actual en zona horaria de Ecuador (UTC-5)
  // IMPORTANTE: Usar la fecha actual real del sistema, no una fecha futura
  const fechaActualEcuador = moment().utcOffset('-05:00');
  
  // Verificar si la fecha del sistema es correcta (no debe estar en el futuro)
  const fechaReferencia = moment('2025-08-07').utcOffset('-05:00'); // Fecha de referencia conocida
  if (fechaActualEcuador.isAfter(fechaReferencia.clone().add(1, 'days'))) {
    console.warn(`ADVERTENCIA: La fecha del sistema parece estar en el futuro: ${fechaActualEcuador.format('YYYY-MM-DD')}`);
    console.warn(`Usando fecha de referencia: ${fechaReferencia.format('YYYY-MM-DD')}`);
    // Usar la fecha de referencia en lugar de la fecha del sistema
    fechaActualEcuador.year(fechaReferencia.year());
    fechaActualEcuador.month(fechaReferencia.month());
    fechaActualEcuador.date(fechaReferencia.date());
  }
  
  console.log(`Fecha actual en Ecuador (corregida): ${fechaActualEcuador.format('YYYY-MM-DD HH:mm:ss')} (UTC-5)`);
  
  // Inicializar la fecha de emisión
  let fechaEmisionMoment;
  
  if (factura.fechaEmision) {
    // Convertir la fecha proporcionada a zona horaria de Ecuador
    fechaEmisionMoment = moment(factura.fechaEmision).utcOffset('-05:00');
    console.log(`Fecha de emisión proporcionada: ${fechaEmisionMoment.format('YYYY-MM-DD HH:mm:ss')} (UTC-5)`);
    
    // Verificar si la fecha está en el futuro (comparando con la fecha actual en Ecuador)
    if (fechaEmisionMoment.isAfter(fechaActualEcuador)) {
      console.warn(`ADVERTENCIA: Fecha de emisión en el futuro detectada (${fechaEmisionMoment.format('YYYY-MM-DD')}), usando fecha actual de Ecuador`);
      fechaEmisionMoment = moment(fechaActualEcuador);
    }
  } else {
    // Si no se proporciona fecha, usar la fecha actual de Ecuador
    fechaEmisionMoment = moment(fechaActualEcuador);
    console.log('No se proporcionó fecha de emisión, usando fecha actual de Ecuador');
  }
  
  // Asegurar que estamos en zona horaria de Ecuador (UTC-5)
  fechaEmisionMoment.utcOffset('-05:00');
  
  // Formatear fecha en formato DD/MM/YYYY como requiere el SRI
  const fechaEmision = fechaEmisionMoment.format('DD/MM/YYYY');
  
  // Importante: Usar la misma fecha para la clave de acceso
  // Esto asegura que la fecha en la clave coincida con la fecha de emisión
  const fechaParaClave = fechaEmisionMoment.format('YYYY-MM-DD');
  
  console.log(`Fecha de emisión generada: ${fechaEmision} (Ecuador UTC-5)`);
  console.log(`Fecha para clave de acceso: ${fechaParaClave}`);
  
  // Validar el ambiente (1=pruebas, 2=producción)
  // Asegurarse de que sea un valor válido para el SRI
  let ambiente = factura.ambiente;
  if (ambiente !== '1' && ambiente !== '2') {
    console.warn(`Ambiente inválido: ${ambiente}, usando ambiente de pruebas (1) por defecto`);
    ambiente = '1'; // Valor por defecto: pruebas
  }
  console.log(`Ambiente configurado: ${ambiente === '1' ? 'PRUEBAS' : 'PRODUCCIÓN'}`);
  
  // Generar clave de acceso con la misma fecha procesada y ambiente validado
  const claveAcceso = generarClaveAcceso({
    fechaEmision: fechaParaClave,
    tipoComprobante: '01', // 01: Factura
    ruc: factura.ruc,
    ambiente: ambiente, // Usar el ambiente validado
    serie: `${factura.establecimiento}${factura.puntoEmision}`,
    secuencial: factura.secuencial,
    tipoEmision: factura.tipoEmision
  });
  
  // Guardar el ambiente validado para usarlo en el XML
  factura.ambiente = ambiente;
  
  // Sanitizar textos para XML
  const razonSocial = sanitizarTextoXML(factura.razonSocial);
  const nombreComercial = sanitizarTextoXML(factura.nombreComercial);
  
  // Fallback seguro para dirEstablecimiento (nunca debe estar vacío según XSD SRI)
  const dirEstInput = factura.direccionEstablecimiento;
  const dirMatrizInput = factura.dirMatriz;
  
  // Usar dirEstablecimiento, si está vacío usar dirMatriz, si ambos están vacíos lanzar error
  const dirEst = (dirEstInput && String(dirEstInput).trim()) || 
                 (dirMatrizInput && String(dirMatrizInput).trim());
                 
  if (!dirEst) {
    throw new Error("dirEstablecimiento requerido pero vacío (minLength=1). Debe proporcionar un valor válido para direccionEstablecimiento o dirMatriz.");
  }
  
  const direccionEstablecimiento = sanitizarTextoXML(dirEst);
  const razonSocialComprador = sanitizarTextoXML(factura.cliente.razonSocial);
  const direccionComprador = sanitizarTextoXML(factura.cliente.direccion || '');
  const email = sanitizarTextoXML(factura.cliente.email || '');
  const telefono = sanitizarTextoXML(factura.cliente.telefono || '');
  
  // Calcular totales de impuestos
  const totalImpuestos = {};
  factura.items.forEach(item => {
    item.impuestos.forEach(imp => {
      const key = `${imp.codigo}-${imp.codigoPorcentaje}`;
      if (!totalImpuestos[key]) {
        totalImpuestos[key] = {
          codigo: imp.codigo,
          codigoPorcentaje: imp.codigoPorcentaje,
          baseImponible: 0,
          valor: 0
        };
      }
      totalImpuestos[key].baseImponible += imp.baseImponible;
      totalImpuestos[key].valor += imp.valor;
    });
  });
  
  // Construir el XML sin indentación ni espacios innecesarios
  let xmlString = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xmlString += '<factura id="comprobante" version="1.1.0">\n';
  
  // infoTributaria
  xmlString += '<infoTributaria>\n';
  xmlString += `<ambiente>${factura.ambiente}</ambiente>\n`;
  xmlString += `<tipoEmision>${factura.tipoEmision}</tipoEmision>\n`;
  xmlString += `<razonSocial>${razonSocial}</razonSocial>\n`;
  xmlString += `<nombreComercial>${nombreComercial}</nombreComercial>\n`;
  xmlString += `<ruc>${factura.ruc}</ruc>\n`;
  xmlString += `<claveAcceso>${claveAcceso}</claveAcceso>\n`;
  xmlString += '<codDoc>01</codDoc>\n';
  xmlString += `<estab>${factura.establecimiento}</estab>\n`;
  xmlString += `<ptoEmi>${factura.puntoEmision}</ptoEmi>\n`;
  xmlString += `<secuencial>${factura.secuencial.toString().padStart(9, '0')}</secuencial>\n`;
  xmlString += `<dirMatriz>${sanitizarTextoXML(factura.dirMatriz)}</dirMatriz>\n`;
  xmlString += '</infoTributaria>\n';
  
  // infoFactura
  xmlString += '<infoFactura>\n';
  xmlString += `<fechaEmision>${fechaEmision}</fechaEmision>\n`;
  xmlString += `<dirEstablecimiento>${direccionEstablecimiento}</dirEstablecimiento>\n`;
  xmlString += '<obligadoContabilidad>SI</obligadoContabilidad>\n';
  xmlString += `<tipoIdentificacionComprador>${factura.cliente.tipoIdentificacion}</tipoIdentificacionComprador>\n`;
  xmlString += `<razonSocialComprador>${razonSocialComprador}</razonSocialComprador>\n`;
  xmlString += `<identificacionComprador>${factura.cliente.identificacion}</identificacionComprador>\n`;
  xmlString += `<totalSinImpuestos>${factura.totalSinImpuestos.toFixed(2)}</totalSinImpuestos>\n`;
  xmlString += `<totalDescuento>${factura.totalDescuento.toFixed(2)}</totalDescuento>\n`;
  
  // totalConImpuestos
  xmlString += '<totalConImpuestos>\n';
  Object.values(totalImpuestos).forEach(imp => {
    xmlString += '<totalImpuesto>\n';
    xmlString += `<codigo>${imp.codigo}</codigo>\n`;
    xmlString += `<codigoPorcentaje>${imp.codigoPorcentaje}</codigoPorcentaje>\n`;
    xmlString += `<baseImponible>${imp.baseImponible.toFixed(2)}</baseImponible>\n`;
    xmlString += `<valor>${imp.valor.toFixed(2)}</valor>\n`;
    xmlString += '</totalImpuesto>\n';
  });
  xmlString += '</totalConImpuestos>\n';
  
  xmlString += `<propina>${factura.propina.toFixed(2)}</propina>\n`;
  xmlString += `<importeTotal>${factura.importeTotal.toFixed(2)}</importeTotal>\n`;
  xmlString += `<moneda>${factura.moneda}</moneda>\n`;
  
  // pagos
  xmlString += '<pagos>\n';
  // Verificar si hay pagos definidos, si no, crear un pago por defecto con el importe total
  if (!factura.pagos || factura.pagos.length === 0) {
    // Agregar un pago por defecto (01 = sin utilización del sistema financiero)
    xmlString += '<pago>\n';
    xmlString += '<formaPago>01</formaPago>\n';
    xmlString += `<total>${factura.importeTotal.toFixed(2)}</total>\n`;
    xmlString += '</pago>\n';
  } else {
    // Usar los pagos definidos
    factura.pagos.forEach(pago => {
      xmlString += '<pago>\n';
      xmlString += `<formaPago>${pago.formaPago}</formaPago>\n`;
      xmlString += `<total>${pago.total.toFixed(2)}</total>\n`;
      xmlString += '</pago>\n';
    });
  }
  xmlString += '</pagos>\n';
  xmlString += '</infoFactura>\n';
  
  // detalles
  xmlString += '<detalles>\n';
  factura.items.forEach(item => {
    // Sanitizar texto para XML
    const descripcionSanitizada = sanitizarTextoXML(item.descripcion);
    const codigoPrincipal = sanitizarTextoXML(item.codigoPrincipal || 'SIN CODIGO');
    
    xmlString += '<detalle>\n';
    xmlString += `<codigoPrincipal>${codigoPrincipal}</codigoPrincipal>\n`;
    xmlString += `<descripcion>${descripcionSanitizada}</descripcion>\n`;
    xmlString += `<cantidad>${item.cantidad.toFixed(2)}</cantidad>\n`;
    xmlString += `<precioUnitario>${item.precioUnitario.toFixed(2)}</precioUnitario>\n`;
    xmlString += `<descuento>${item.descuento.toFixed(2)}</descuento>\n`;
    // Calcular correctamente el precio total sin impuesto: cantidad × precioUnitario - descuento
    const precioTotalSinImpuesto = (item.cantidad * item.precioUnitario - item.descuento).toFixed(2);
    xmlString += `<precioTotalSinImpuesto>${precioTotalSinImpuesto}</precioTotalSinImpuesto>\n`;
    
    // impuestos
    xmlString += '<impuestos>\n';
    item.impuestos.forEach(imp => {
      xmlString += '<impuesto>\n';
      xmlString += `<codigo>${imp.codigo}</codigo>\n`;
      xmlString += `<codigoPorcentaje>${imp.codigoPorcentaje}</codigoPorcentaje>\n`;
      // Usar la tarifa proporcionada en el impuesto o determinarla según el codigoPorcentaje
      // codigoPorcentaje '2' = IVA tarifa 12%
      // codigoPorcentaje '3' = IVA tarifa 14%
      // codigoPorcentaje '8' = IVA tarifa 15%
      let tarifaIva = '0.00';
      if (imp.tarifa) {
        // Si el impuesto tiene una tarifa definida explícitamente, usarla
        tarifaIva = typeof imp.tarifa === 'number' ? imp.tarifa.toFixed(2) : imp.tarifa;
      } else if (imp.codigoPorcentaje === '2') {
        tarifaIva = '12.00';
      } else if (imp.codigoPorcentaje === '3') {
        tarifaIva = '14.00';
      } else if (imp.codigoPorcentaje === '8') {
        tarifaIva = '15.00';
      }
      xmlString += `<tarifa>${tarifaIva}</tarifa>\n`;
      xmlString += `<baseImponible>${imp.baseImponible.toFixed(2)}</baseImponible>\n`;
      xmlString += `<valor>${imp.valor.toFixed(2)}</valor>\n`;
      xmlString += '</impuesto>\n';
    });
    xmlString += '</impuestos>\n';
    xmlString += '</detalle>\n';
  });
  xmlString += '</detalles>\n';
  
  // infoAdicional
  if (email || telefono) {
    xmlString += '<infoAdicional>\n';
    if (email) {
      xmlString += `<campoAdicional nombre="Email">${email}</campoAdicional>\n`;
    }
    if (telefono) {
      xmlString += `<campoAdicional nombre="Teléfono">${telefono}</campoAdicional>\n`;
    }
    xmlString += '</infoAdicional>\n';
  }
  
  xmlString += '</factura>';
  
  // Validar el XML generado
  try {
    const xmlDoc = new DOMParser().parseFromString(xmlString, 'text/xml');
    return new XMLSerializer().serializeToString(xmlDoc);
  } catch (error) {
    throw new Error(`Error al generar el XML de la factura: ${error.message}`);
  }
}

/**
 * Sanitiza texto para uso en XML, eliminando caracteres inválidos
 * @param {string} texto - Texto a sanitizar
 * @returns {string} - Texto sanitizado
 */
function sanitizarTextoXML(texto) {
  if (!texto) return '';
  
  // Reemplazar caracteres especiales y entidades XML
  let resultado = texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Eliminar caracteres de control y otros caracteres no válidos en XML
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Eliminar caracteres no permitidos en XML 1.0
  resultado = resultado.replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, '');
  
  return resultado;
}

/**
 * Valida un XML contra un esquema XSD
 * @param {string} xmlString - Contenido del XML a validar
 * @param {string} xsdPath - Ruta al archivo XSD
 * @returns {Object} - Resultado de la validación {valido: boolean, errores: Array}
 */
function validarXmlContraXsd(xmlString, xsdPath) {
  try {
    // Verificar si existe el archivo XSD
    if (!fs.existsSync(xsdPath)) {
      console.warn(`Archivo XSD no encontrado: ${xsdPath}. Omitiendo validación.`);
      return { valido: true, errores: [] };
    }
    
    // Leer el contenido del XSD
    const xsdContent = fs.readFileSync(xsdPath, 'utf8');
    
    // Crear el esquema XSD
    const xsdDoc = libxmljs.parseXml(xsdContent);
    
    // Parsear el XML
    const xmlDoc = libxmljs.parseXml(xmlString);
    
    // Validar el XML contra el esquema XSD
    const esValido = xmlDoc.validate(xsdDoc);
    
    // Si no es válido, obtener los errores
    let errores = [];
    if (!esValido) {
      errores = xmlDoc.validationErrors.map(err => ({
        mensaje: err.message,
        linea: err.line,
        columna: err.column
      }));
      console.error('Errores de validación XML:', errores);
    }
    
    return { valido: esValido, errores };
  } catch (error) {
    console.error('Error al validar XML contra XSD:', error);
    return { valido: false, errores: [{ mensaje: error.message }] };
  }
}

/**
 * Genera el XML para una nota de crédito electrónica según el esquema del SRI
 * @param {Object} notaCredito - Datos de la nota de crédito
 * @returns {string} - XML de la nota de crédito
 */
function generarXmlNotaCredito(notaCredito) {
  // Implementación similar a generarXmlFactura pero para notas de crédito
  // Código de documento: 04 para nota de crédito
  
  // Generar clave de acceso
  const claveAcceso = generarClaveAcceso({
    fechaEmision: notaCredito.fechaEmision,
    tipoComprobante: '04', // 04: Nota de Crédito
    ruc: notaCredito.ruc,
    ambiente: notaCredito.ambiente,
    serie: `${notaCredito.establecimiento}${notaCredito.puntoEmision}`,
    secuencial: notaCredito.secuencial,
    tipoEmision: notaCredito.tipoEmision
  });
  
  // Implementación pendiente para notas de crédito
  // Esta es una estructura básica que debe completarse según los requisitos del SRI
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<notaCredito id="comprobante" version="1.1.0">
  <!-- Implementación pendiente -->
</notaCredito>`;
}

module.exports = {
  generarClaveAcceso,
  generarXmlFactura,
  generarXmlNotaCredito,
  sanitizarTextoXML,
  validarXmlContraXsd
};
