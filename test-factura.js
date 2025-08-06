/**
 * Script de prueba para generar y procesar una factura electrónica
 * Útil para verificar el flujo completo de integración con el SRI
 */
require('dotenv').config();
const { generateXml, signXml, procesarComprobante } = require('./services');
const logger = require('./logger');

// Datos de prueba para la factura
const datosFactura = {
  // Información del cliente
  cliente: {
    tipoIdentificacion: '04', // 04: RUC, 05: CEDULA, 07: CONSUMIDOR FINAL
    identificacion: '1792060346001', // RUC o cédula del cliente
    razonSocial: 'EMPRESA DE PRUEBA S.A.',
    direccion: 'Av. Amazonas N36-152 y Naciones Unidas',
    email: 'cliente@ejemplo.com',
    telefono: '022000000'
  },
  
  // Información de la factura
  factura: {
    fechaEmision: new Date().toISOString().split('T')[0],
    secuencial: '000000001',
    formaPago: '01', // 01: SIN UTILIZACIÓN DEL SISTEMA FINANCIERO
    importeTotal: 112.00,
    moneda: 'DOLAR',
    propina: 0,
    items: [
      {
        codigo: 'PROD-001',
        descripcion: 'Producto de prueba 1',
        cantidad: 2,
        precioUnitario: 50.00,
        descuento: 0,
        precioTotalSinImpuesto: 100.00,
        impuestos: [
          {
            codigo: '2', // 2: IVA
            codigoPorcentaje: '2', // 2: IVA 12%
            tarifa: 12,
            baseImponible: 100.00,
            valor: 12.00
          }
        ]
      }
    ],
    totalSinImpuestos: 100.00,
    totalDescuento: 0,
    impuestos: [
      {
        codigo: '2', // 2: IVA
        codigoPorcentaje: '2', // 2: IVA 12%
        baseImponible: 100.00,
        valor: 12.00
      }
    ]
  }
};

/**
 * Función principal para ejecutar la prueba
 */
async function ejecutarPrueba() {
  try {
    logger.info('Iniciando prueba de facturación electrónica', { datosFactura });
    
    // Paso 1: Verificar variables de entorno
    logger.info('Verificando variables de entorno...');
    const variablesRequeridas = [
      'EMPRESA_RUC',
      'EMPRESA_RAZON_SOCIAL',
      'EMPRESA_NOMBRE_COMERCIAL',
      'EMPRESA_DIRECCION_MATRIZ',
      'EMPRESA_CODIGO_ESTABLECIMIENTO',
      'EMPRESA_PUNTO_EMISION',
      'CERTIFICADO_PATH',
      'CERTIFICADO_CLAVE',
      'SRI_AMBIENTE'
    ];
    
    const variablesFaltantes = variablesRequeridas.filter(variable => !process.env[variable]);
    if (variablesFaltantes.length > 0) {
      throw new Error(`Faltan variables de entorno requeridas: ${variablesFaltantes.join(', ')}`);
    }
    
    // Paso 2: Generar XML
    logger.info('Generando XML de factura...');
    const xmlContent = await generateXml(datosFactura);
    logger.info('XML generado correctamente');
    
    // Paso 3: Firmar XML
    logger.info('Firmando XML...');
    const certificadoPath = process.env.CERTIFICADO_PATH;
    const certificadoClave = process.env.CERTIFICADO_CLAVE;
    const xmlSigned = await signXml(xmlContent, certificadoPath, certificadoClave);
    logger.info('XML firmado correctamente');
    
    // Paso 4: Procesar comprobante (enviar, autorizar y guardar)
    logger.info('Procesando comprobante...');
    const ambiente = process.env.SRI_AMBIENTE;
    const resultado = await procesarComprobante(xmlSigned, ambiente);
    
    logger.info('Prueba completada con éxito', { resultado });
    console.log('\n=== RESULTADO DE LA PRUEBA ===');
    console.log(JSON.stringify(resultado, null, 2));
    
    return resultado;
  } catch (error) {
    logger.error('Error en la prueba de facturación', { error: error.message, stack: error.stack });
    console.error('\n=== ERROR EN LA PRUEBA ===');
    console.error(error);
    throw error;
  }
}

// Ejecutar la prueba
ejecutarPrueba()
  .then(() => {
    console.log('\nPrueba finalizada correctamente');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nLa prueba falló:', error.message);
    process.exit(1);
  });
