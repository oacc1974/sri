# Proceso de Certificación Técnica ante el SRI

Este documento describe los pasos necesarios para completar el proceso de certificación técnica ante el Servicio de Rentas Internas (SRI) de Ecuador para la facturación electrónica.

## Requisitos Previos

1. **Certificado Digital**: 
   - Debe tener un certificado digital válido (.p12 o .pfx) emitido por una entidad autorizada (Banco Central, Security Data, etc.)
   - El certificado debe estar a nombre del contribuyente y vigente
   - Colocar el certificado en el directorio `/certificados` de la aplicación

2. **Datos de Empresa**:
   - Configurar correctamente todas las variables de entorno en el archivo `.env` relacionadas con la empresa:
     - `EMPRESA_RUC`
     - `EMPRESA_RAZON_SOCIAL`
     - `EMPRESA_NOMBRE_COMERCIAL`
     - `EMPRESA_DIRECCION_MATRIZ`
     - `EMPRESA_CODIGO_ESTABLECIMIENTO`
     - `EMPRESA_PUNTO_EMISION`
     - `EMPRESA_OBLIGADO_CONTABILIDAD` (SI/NO)

3. **Ambiente de Pruebas**:
   - Configurar `SRI_AMBIENTE=1` en el archivo `.env` (1 para pruebas, 2 para producción)

## Pasos para la Certificación

### 1. Verificación del Certificado Digital

Antes de iniciar el proceso de certificación, verifique que el certificado digital funciona correctamente:

```bash
# Iniciar el servidor en modo desarrollo
npm run dev

# Acceder a la ruta de verificación del certificado
curl http://localhost:5000/api/certificado/verificar
```

La respuesta debe mostrar información del certificado, incluyendo el titular y la fecha de vencimiento.

### 2. Generación de Comprobantes de Prueba

Debe generar y enviar al SRI al menos un comprobante de cada tipo que utilizará en producción:

1. **Factura**:
   - Generar al menos 3 facturas de prueba con diferentes escenarios:
     - Cliente con RUC
     - Cliente con cédula
     - Consumidor final
   - Incluir diferentes tipos de impuestos (IVA 12%, 0%, etc.)

2. **Nota de Crédito** (si aplica):
   - Generar al menos 1 nota de crédito relacionada a una factura

3. **Retención** (si aplica):
   - Generar al menos 1 comprobante de retención

### 3. Verificación de Comprobantes

Para cada comprobante generado, verificar:

1. **Estructura XML**:
   - El XML debe cumplir con el esquema XSD del SRI
   - La firma digital debe ser válida

2. **Recepción**:
   - El comprobante debe ser recibido correctamente por el SRI
   - Verificar el estado "RECIBIDO"

3. **Autorización**:
   - El comprobante debe ser autorizado por el SRI
   - Verificar el estado "AUTORIZADO"

4. **Representación Impresa**:
   - Verificar que el RIDE (Representación Impresa del Documento Electrónico) se genere correctamente

### 4. Solicitud de Certificación

Una vez completadas las pruebas exitosamente:

1. Ingresar al portal del SRI (www.sri.gob.ec)
2. Acceder a "Servicios en Línea" con su usuario y contraseña
3. Ir a la sección "Comprobantes Electrónicos"
4. Seleccionar "Producción" y solicitar la certificación
5. Completar el formulario indicando:
   - Tipos de comprobantes a utilizar
   - Software utilizado (propio)
   - Datos de contacto técnico

### 5. Transición a Producción

Una vez aprobada la certificación por el SRI:

1. Modificar la configuración en el archivo `.env`:
   ```
   SRI_AMBIENTE=2
   ```

2. Realizar pruebas de verificación en producción:
   - Generar un comprobante real
   - Verificar todo el ciclo de vida del comprobante

## Monitoreo y Mantenimiento

### Logs y Seguimiento

La aplicación cuenta con un sistema de logs que permite monitorear todas las transacciones con el SRI:

- Acceder a `/api/logs` para ver los logs del sistema
- Filtrar por fecha y tipo de log (all, errors, sri)
- Monitorear especialmente los errores y transacciones fallidas

### Manejo de Errores Comunes

1. **Error de Conexión**:
   - Verificar conectividad a internet
   - Verificar que los servicios del SRI estén disponibles

2. **Error de Firma**:
   - Verificar que el certificado sea válido y no haya expirado
   - Verificar la contraseña del certificado

3. **Error de Esquema**:
   - Verificar que el XML generado cumpla con el esquema XSD del SRI
   - Revisar los datos de la empresa y del comprobante

4. **Error de Autorización**:
   - Verificar los mensajes específicos del SRI
   - Corregir según las indicaciones y reintentar

## Contacto SRI

Para soporte técnico durante el proceso de certificación:

- Centro de Atención Telefónica: 1700-774-774
- Correo electrónico: facturacionelectronica@sri.gob.ec

## Referencias

- [Documentación oficial del SRI sobre Facturación Electrónica](https://www.sri.gob.ec/facturacion-electronica)
- [Esquemas XSD oficiales](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/6477b86b-1713-4865-abb5-8c4428be03c7/XSD.zip)
