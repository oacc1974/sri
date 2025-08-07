/**
 * Módulo para firmar digitalmente los XML para el SRI Ecuador
 * Basado en los requisitos oficiales del SRI para facturación electrónica
 * @see https://www.sri.gob.ec/facturacion-electronica
 */
const fs = require('fs');
const SignedXml = require('xml-crypto').SignedXml;
const xpath = require('xpath');
const { DOMParser, XMLSerializer } = require('xmldom');
const forge = require('node-forge');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Extrae información del certificado digital
 * @param {string} certificatePath - Ruta al archivo del certificado .p12
 * @param {string} certificatePassword - Contraseña del certificado
 * @returns {Object} - Información del certificado
 */
function extraerInfoCertificado(certificatePath, certificatePassword) {
  try {
    // Verificar que el certificado existe
    if (!fs.existsSync(certificatePath)) {
      throw new Error(`Certificado no encontrado en: ${certificatePath}`);
    }

    // Leer el certificado
    const p12Buffer = fs.readFileSync(certificatePath);
    
    // Parsear el certificado PKCS#12
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(p12Buffer.toString('binary')), 
      certificatePassword
    );
    
    // Extraer la clave privada y el certificado
    let privateKey = null;
    let certificate = null;
    
    p12.safeContents.forEach((safeContent) => {
      safeContent.safeBags.forEach((safeBag) => {
        if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag) {
          privateKey = safeBag.key;
        } else if (safeBag.type === forge.pki.oids.certBag) {
          certificate = safeBag.cert;
        }
      });
    });
    
    if (!privateKey || !certificate) {
      throw new Error('No se pudo extraer la clave privada o el certificado');
    }
    
    // Extraer información del certificado
    const subject = certificate.subject.getField('CN');
    const issuer = certificate.issuer.getField('CN');
    const validFrom = certificate.validity.notBefore;
    const validTo = certificate.validity.notAfter;
    
    // Intentar extraer más información del certificado
    let ruc = null;
    let nombreTitular = null;
    
    // Buscar RUC en varios campos posibles
    const camposRuc = ['serialNumber', 'UID', 'OID.2.5.4.45'];
    for (const campo of camposRuc) {
      const field = certificate.subject.getField(campo);
      if (field) {
        ruc = field.value;
        break;
      }
    }
    
    // Buscar nombre del titular
    const camposNombre = ['CN', 'O', 'OU', 'name'];
    for (const campo of camposNombre) {
      const field = certificate.subject.getField(campo);
      if (field) {
        nombreTitular = field.value;
        break;
      }
    }
    
    return {
      subject: subject ? subject.value : 'Desconocido',
      issuer: issuer ? issuer.value : 'Desconocido',
      validFrom: validFrom,
      validTo: validTo,
      privateKey: privateKey,
      certificate: certificate,
      rucTitular: ruc,
      nombreTitular: nombreTitular
    };
  } catch (error) {
    console.error('Error al extraer información del certificado:', error);
    throw new Error(`Error al extraer información del certificado: ${error.message}`);
  }
}

/**
 * Verifica si un certificado es válido (no expirado) y extrae información detallada
 * @param {string} certificatePath - Ruta al archivo del certificado .p12
 * @param {string} certificatePassword - Contraseña del certificado
 * @returns {Object} - Resultado de la validación con información detallada
 */
async function verificarCertificado(certificatePath, certificatePassword) {
  try {
    const info = extraerInfoCertificado(certificatePath, certificatePassword);
    const ahora = new Date();
    
    const esValido = ahora >= info.validFrom && ahora <= info.validTo;
    const diasRestantes = esValido ? Math.ceil((info.validTo - ahora) / (1000 * 60 * 60 * 24)) : 0;
    
    // Extraer datos específicos del sujeto y emisor
    const extraerDatos = (str) => {
      const datos = {};
      const pares = str.split(',').map(s => s.trim());
      pares.forEach(par => {
        const [clave, ...valorArr] = par.split('=');
        const valor = valorArr.join('='); // Por si el valor contiene '='
        if (clave && valor) {
          datos[clave.trim()] = valor.trim();
        }
      });
      return datos;
    };
    
    const datosSujeto = extraerDatos(info.subject);
    const datosEmisor = extraerDatos(info.issuer);
    
    // Verificar si el certificado es de firma digital (no de sello de tiempo u otro tipo)
    const esFirmaDigital = info.extensions && 
      info.extensions.some(ext => 
        ext.name === 'keyUsage' && 
        ext.digitalSignature === true && 
        ext.nonRepudiation === true
      );
    
    return {
      valido: esValido,
      razon: esValido ? `Certificado válido (${diasRestantes} días restantes)` : 'Certificado expirado',
      diasRestantes: diasRestantes,
      esFirmaDigital: esFirmaDigital,
      info: {
        emisor: info.issuer,
        emisorDatos: datosEmisor,
        entidadCertificadora: datosEmisor.O || datosEmisor.CN || 'Desconocida',
        sujeto: info.subject,
        sujetoDatos: datosSujeto,
        nombreTitular: info.nombreTitular || datosSujeto.CN || 'Desconocido',
        rucTitular: info.rucTitular || datosSujeto.serialNumber || 'No especificado',
        validoDesde: info.validFrom,
        validoHasta: info.validTo,
        serialNumber: info.serialNumber || 'No disponible',
        algoritmoFirma: info.signatureAlgorithm || 'No disponible',
        huella: info.fingerPrint || 'No disponible'
      },
      advertencias: []
    };
  } catch (error) {
    return {
      valido: false,
      razon: `Error al verificar el certificado: ${error.message}`,
      info: null,
      error: error.message,
      advertencias: [`Error al procesar el certificado: ${error.message}`]
    };
  }
}

/**
 * Firma un XML con un certificado digital según los requisitos del SRI
 * @param {string} xmlString - XML a firmar en formato string
 * @param {string} certificatePath - Ruta al archivo del certificado .p12
 * @param {string} certificatePassword - Contraseña del certificado
 * @returns {Promise<string>} - XML firmado
 */
async function signXml(xmlString, certificatePath, certificatePassword) {
  try {
    // Verificar que el certificado existe
    if (!fs.existsSync(certificatePath)) {
      throw new Error(`Certificado no encontrado en: ${certificatePath}`);
    }

    // Verificar que el certificado es válido
    const verificacion = verificarCertificado(certificatePath, certificatePassword);
    if (!verificacion.valido) {
      throw new Error(`Certificado no válido: ${verificacion.razon}`);
    }
    
    console.log(`Firmando XML con certificado de: ${verificacion.info.sujeto}`);
    
    // Leer el certificado
    const certBuffer = fs.readFileSync(certificatePath);
    
    // Crear el documento XML
    const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
    
    // Obtener el nodo raíz para firmar (factura, notaCredito, etc.)
    const rootNodeName = doc.documentElement.nodeName;
    const rootNode = doc.documentElement;
    
    if (!rootNode) {
      throw new Error(`No se encontró el nodo raíz ${rootNodeName} en el XML`);
    }
    
    // Configurar la firma
    const sig = new SignedXml();
    
    // Configurar la referencia al nodo que se va a firmar
    sig.addReference(
      `//${rootNodeName}`,
      [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
      ],
      'http://www.w3.org/2000/09/xmldsig#sha1',
      '',
      '',
      '',
      true
    );
    
    // Configurar la clave de firma
    sig.signingKey = certBuffer;
    
    // Configurar la información del certificado
    sig.keyInfoProvider = {
      getKeyInfo: function() {
        // Extraer el certificado en formato base64
        const info = extraerInfoCertificado(certificatePath, certificatePassword);
        const certPem = forge.pki.certificateToPem(info.certificate);
        const certBase64 = certPem
          .replace('-----BEGIN CERTIFICATE-----', '')
          .replace('-----END CERTIFICATE-----', '')
          .replace(/\r?\n/g, '');
        
        return `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;
      }
    };
    
    // Firmar el documento
    sig.computeSignature(xmlString);
    
    // Obtener el XML firmado
    const signedXml = sig.getSignedXml();
    
    // Validar que el XML firmado sea válido
    try {
      const validationDoc = new DOMParser().parseFromString(signedXml, 'text/xml');
      return new XMLSerializer().serializeToString(validationDoc);
    } catch (validationError) {
      throw new Error(`Error al validar el XML firmado: ${validationError.message}`);
    }
  } catch (error) {
    console.error('Error al firmar el XML:', error);
    throw new Error(`Error al firmar el XML: ${error.message}`);
  }
}

module.exports = {
  signXml,
  verificarCertificado,
  extraerInfoCertificado
};
