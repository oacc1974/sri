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
  const coeficientes = [2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7];
  
  for (let i = 0; i < claveBase.length; i++) {
    suma += parseInt(claveBase.charAt(i)) * coeficientes[i];
  }
  
  const digitoVerificador = (11 - (suma % 11)) === 11 ? 0 : (11 - (suma % 11)) === 10 ? 1 : (11 - (suma % 11));
  
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
  // Generar clave de acceso
  const claveAcceso = generarClaveAcceso({
    fechaEmision: factura.fechaEmision,
    tipoComprobante: '01', // 01: Factura
    ruc: factura.ruc,
    ambiente: factura.ambiente,
    serie: `${factura.establecimiento}${factura.puntoEmision}`,
    secuencial: factura.secuencial,
    tipoEmision: factura.tipoEmision
  });
  
  // Formatear fecha
  const fechaEmision = moment(factura.fechaEmision).format('DD/MM/YYYY');
  
  // Generar detalles
  let detalles = '';
  factura.items.forEach(item => {
    // Sanitizar texto para XML
    const descripcionSanitizada = sanitizarTextoXML(item.descripcion);
    const codigoPrincipal = sanitizarTextoXML(item.codigoPrincipal || 'SIN CODIGO');
    
    const impuestos = item.impuestos.map(imp => `
          <impuesto>
            <codigo>${imp.codigo}</codigo>
            <codigoPorcentaje>${imp.codigoPorcentaje}</codigoPorcentaje>
            <tarifa>${imp.codigoPorcentaje === '2' ? '12.00' : '0.00'}</tarifa>
            <baseImponible>${imp.baseImponible.toFixed(2)}</baseImponible>
            <valor>${imp.valor.toFixed(2)}</valor>
          </impuesto>`).join('');
    
    detalles += `
        <detalle>
          <codigoPrincipal>${codigoPrincipal}</codigoPrincipal>
          <descripcion>${descripcionSanitizada}</descripcion>
          <cantidad>${item.cantidad.toFixed(2)}</cantidad>
          <precioUnitario>${item.precioUnitario.toFixed(2)}</precioUnitario>
          <descuento>${item.descuento.toFixed(2)}</descuento>
          <precioTotalSinImpuesto>${item.precioTotalSinImpuestos.toFixed(2)}</precioTotalSinImpuesto>
          <impuestos>${impuestos}
          </impuestos>
        </detalle>`;
  });
  
  // Generar pagos
  let pagos = '';
  factura.pagos.forEach(pago => {
    pagos += `
          <pago>
            <formaPago>${pago.formaPago}</formaPago>
            <total>${pago.total.toFixed(2)}</total>
            <plazo>${pago.plazo}</plazo>
            <unidadTiempo>${pago.unidadTiempo}</unidadTiempo>
          </pago>`;
  });
  
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
  
  let impuestosXml = '';
  Object.values(totalImpuestos).forEach(imp => {
    impuestosXml += `
          <totalImpuesto>
            <codigo>${imp.codigo}</codigo>
            <codigoPorcentaje>${imp.codigoPorcentaje}</codigoPorcentaje>
            <baseImponible>${imp.baseImponible.toFixed(2)}</baseImponible>
            <valor>${imp.valor.toFixed(2)}</valor>
          </totalImpuesto>`;
  });
  
  // Sanitizar textos para XML
  const razonSocial = sanitizarTextoXML(factura.razonSocial);
  const nombreComercial = sanitizarTextoXML(factura.nombreComercial);
  const direccionEstablecimiento = sanitizarTextoXML(factura.direccionEstablecimiento);
  const razonSocialComprador = sanitizarTextoXML(factura.cliente.razonSocial);
  const direccionComprador = sanitizarTextoXML(factura.cliente.direccion || '');
  const email = sanitizarTextoXML(factura.cliente.email || '');
  const telefono = sanitizarTextoXML(factura.cliente.telefono || '');
  
  // Generar XML completo
  const xmlString = `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="1.1.0">
  <infoTributaria>
    <ambiente>${factura.ambiente}</ambiente>
    <tipoEmision>${factura.tipoEmision}</tipoEmision>
    <razonSocial>${razonSocial}</razonSocial>
    <nombreComercial>${nombreComercial}</nombreComercial>
    <ruc>${factura.ruc}</ruc>
    <claveAcceso>${claveAcceso}</claveAcceso>
    <codDoc>01</codDoc>
    <estab>${factura.establecimiento}</estab>
    <ptoEmi>${factura.puntoEmision}</ptoEmi>
    <secuencial>${factura.secuencial.toString().padStart(9, '0')}</secuencial>
    <dirMatriz>${direccionEstablecimiento}</dirMatriz>
  </infoTributaria>
  <infoFactura>
    <fechaEmision>${fechaEmision}</fechaEmision>
    <dirEstablecimiento>${direccionEstablecimiento}</dirEstablecimiento>
    <obligadoContabilidad>SI</obligadoContabilidad>
    <tipoIdentificacionComprador>${factura.cliente.tipoIdentificacion}</tipoIdentificacionComprador>
    <razonSocialComprador>${razonSocialComprador}</razonSocialComprador>
    <identificacionComprador>${factura.cliente.identificacion}</identificacionComprador>
    <direccionComprador>${direccionComprador}</direccionComprador>
    <totalSinImpuestos>${factura.totalSinImpuestos.toFixed(2)}</totalSinImpuestos>
    <totalDescuento>${factura.totalDescuento.toFixed(2)}</totalDescuento>
    <totalConImpuestos>${impuestosXml}
    </totalConImpuestos>
    <propina>${factura.propina.toFixed(2)}</propina>
    <importeTotal>${factura.importeTotal.toFixed(2)}</importeTotal>
    <moneda>${factura.moneda}</moneda>
    <pagos>${pagos}
    </pagos>
  </infoFactura>
  <detalles>${detalles}
  </detalles>
  <infoAdicional>
    <campoAdicional nombre="email">${email}</campoAdicional>
    <campoAdicional nombre="telefono">${telefono}</campoAdicional>
  </infoAdicional>
</factura>`;
  
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
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Eliminar caracteres de control y otros caracteres no válidos en XML
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Valida un XML contra un esquema XSD
 * @param {string} xmlString - Contenido del XML a validar
 * @param {string} xsdPath - Ruta al archivo XSD
 * @returns {boolean} - true si el XML es válido, false en caso contrario
 */
function validarXmlContraXsd(xmlString, xsdPath) {
  try {
    // Verificar si existe el archivo XSD
    if (!fs.existsSync(xsdPath)) {
      console.warn(`Archivo XSD no encontrado: ${xsdPath}. Omitiendo validación.`);
      return true;
    }
    
    // Leer el contenido del XSD
    const xsdContent = fs.readFileSync(xsdPath, 'utf8');
    
    // Crear el esquema XSD
    const xsdDoc = libxmljs.parseXml(xsdContent);
    
    // Parsear el XML
    const xmlDoc = libxmljs.parseXml(xmlString);
    
    // Validar el XML contra el esquema XSD
    return xmlDoc.validate(xsdDoc);
  } catch (error) {
    console.error('Error al validar XML contra XSD:', error);
    return false;
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
