/**
 * Utilidades para manejo de certificados digitales en Render y otros entornos
 * Permite cargar certificados desde archivo o desde variable de entorno base64
 */
const fs = require('fs');
const path = require('path');

/**
 * Carga un certificado digital desde archivo o desde variable de entorno base64
 * @param {string} certPath - Ruta al archivo del certificado o nombre de la variable de entorno
 * @param {boolean} isBase64Env - Si es true, certPath es el nombre de la variable de entorno con el certificado en base64
 * @returns {Object} - Información del certificado cargado (ruta y método)
 */
function loadCertificate(certPath, isBase64Env = false) {
  // Si es una variable de entorno base64
  if (isBase64Env) {
    const certBase64 = process.env[certPath];
    if (!certBase64) {
      throw new Error(`Variable de entorno ${certPath} no encontrada o vacía`);
    }
    
    console.log(`Cargando certificado desde variable de entorno ${certPath}`);
    
    try {
      // Convertir base64 a buffer
      const certBuffer = Buffer.from(certBase64, 'base64');
      
      // Crear directorio temporal si no existe
      const tmpDir = path.join(__dirname, 'tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
        console.log(`Directorio temporal creado: ${tmpDir}`);
      }
      
      // Guardar temporalmente en disco
      const tmpCertPath = path.join(tmpDir, 'temp_certificate.p12');
      fs.writeFileSync(tmpCertPath, certBuffer);
      console.log(`Certificado guardado temporalmente en: ${tmpCertPath}`);
      
      return {
        path: tmpCertPath,
        method: 'base64_env'
      };
    } catch (error) {
      console.error('Error al procesar certificado desde variable de entorno:', error);
      throw new Error(`Error al procesar certificado desde variable de entorno: ${error.message}`);
    }
  }
  
  // Si es un archivo
  // Asegurar que la ruta sea absoluta
  const absoluteCertPath = path.isAbsolute(certPath) ? 
    certPath : 
    path.join(__dirname, certPath);
  
  console.log(`Intentando cargar certificado desde archivo: ${absoluteCertPath}`);
  
  // Verificar que el certificado existe
  if (fs.existsSync(absoluteCertPath)) {
    return {
      path: absoluteCertPath,
      method: 'file'
    };
  }
  
  // Intentar buscar en ubicaciones alternativas
  const altPaths = [
    path.join(__dirname, 'certificados', path.basename(certPath)),
    path.join('/opt/render/project/src/certificados', path.basename(certPath))
  ];
  
  for (const altPath of altPaths) {
    console.log(`Intentando ubicación alternativa: ${altPath}`);
    if (fs.existsSync(altPath)) {
      console.log(`Certificado encontrado en: ${altPath}`);
      return {
        path: altPath,
        method: 'file_alt'
      };
    }
  }
  
  // Si llegamos aquí, no se encontró el certificado
  throw new Error(`Certificado no encontrado en: ${absoluteCertPath} ni en ubicaciones alternativas`);
}

module.exports = {
  loadCertificate
};
