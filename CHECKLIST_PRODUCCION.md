# Checklist para Despliegue en Producción

Este documento proporciona una lista de verificación para preparar la integración Loyverse-SRI para su despliegue en producción.

## 1. Certificado Digital

- [ ] Certificado digital válido y vigente (.p12/.pfx) configurado en el servidor de producción
- [ ] Certificado almacenado en el directorio `certificados` con permisos adecuados
- [ ] Contraseña del certificado configurada en variables de entorno (no en código)
- [ ] Verificar que el certificado sea de firma digital (no de sello de tiempo)
- [ ] Comprobar que el certificado tenga al menos 30 días de vigencia

## 2. Configuración del Entorno

- [ ] Archivo `.env` configurado con todas las variables requeridas
- [ ] Variable `SRI_AMBIENTE=2` para ambiente de producción
- [ ] Datos de la empresa correctamente configurados:
  - [ ] RUC
  - [ ] Razón social
  - [ ] Nombre comercial
  - [ ] Dirección matriz
  - [ ] Código de establecimiento
  - [ ] Punto de emisión
  - [ ] Obligado a contabilidad (SI/NO)
- [ ] Token de Loyverse API configurado y verificado
- [ ] Directorio `comprobantes` con permisos de escritura

## 3. Certificación Técnica SRI

- [ ] Proceso de certificación técnica completado exitosamente
- [ ] Comprobantes de prueba enviados y autorizados en ambiente de pruebas
- [ ] Correcciones implementadas según retroalimentación del SRI
- [ ] Certificado de aprobación recibido del SRI

## 4. Seguridad

- [ ] Certificado digital protegido con permisos adecuados
- [ ] Variables de entorno protegidas (no en control de versiones)
- [ ] Implementar HTTPS para todas las comunicaciones
- [ ] Revisar permisos de directorios y archivos
- [ ] Validación de entrada implementada para todos los endpoints
- [ ] Protección contra inyección y otros ataques comunes

## 5. Rendimiento y Escalabilidad

- [ ] Pruebas de carga realizadas
- [ ] Manejo de concurrencia implementado
- [ ] Sistema de colas para procesamiento de facturas (opcional)
- [ ] Monitoreo de recursos del servidor configurado
- [ ] Estrategia de respaldo y recuperación implementada

## 6. Monitoreo y Logging

- [ ] Sistema de logs configurado y funcionando
- [ ] Rotación de logs implementada
- [ ] Alertas configuradas para errores críticos
- [ ] Dashboard de monitoreo implementado (opcional)
- [ ] Verificación periódica del estado del certificado digital

## 7. Documentación

- [ ] Manual de usuario completado
- [ ] Documentación técnica actualizada
- [ ] Procedimientos de respaldo y recuperación documentados
- [ ] Procedimiento de renovación de certificado documentado
- [ ] Contactos de soporte SRI y Loyverse documentados

## 8. Pruebas Finales

- [ ] Pruebas end-to-end completadas en ambiente de producción
- [ ] Verificación de todos los endpoints
- [ ] Pruebas de integración con Loyverse
- [ ] Pruebas de integración con SRI
- [ ] Pruebas de recuperación ante fallos

## 9. Plan de Contingencia

- [ ] Procedimiento para manejo de fallos en la conexión con Loyverse
- [ ] Procedimiento para manejo de fallos en la conexión con SRI
- [ ] Procedimiento para manejo de fallos en el certificado digital
- [ ] Plan de rollback en caso de problemas graves
- [ ] Contactos de emergencia establecidos

## 10. Post-Despliegue

- [ ] Monitoreo inicial intensivo (primeras 24-48 horas)
- [ ] Verificación de primeras facturas en producción
- [ ] Ajustes de configuración según necesidad
- [ ] Recopilación de feedback de usuarios
- [ ] Planificación de mejoras futuras

---

## Notas Importantes

1. **Renovación del Certificado**: Los certificados digitales suelen tener validez de 1-2 años. Programar la renovación con anticipación.

2. **Cambios en Normativa SRI**: Estar atento a cambios en la normativa o esquemas XSD del SRI que puedan requerir actualizaciones.

3. **Actualizaciones de Loyverse API**: Verificar periódicamente si hay cambios en la API de Loyverse que puedan afectar la integración.

4. **Respaldos**: Implementar respaldos periódicos de la base de datos y comprobantes generados.

5. **Soporte**: Establecer un canal de soporte para usuarios y un procedimiento para reportar y resolver incidencias.
