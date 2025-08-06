# Integración Loyverse - SRI Ecuador

Una aplicación web simple que integra Loyverse con el SRI de Ecuador para la facturación electrónica automática.

## Características

- Autenticación con token de Loyverse
- Sincronización automática de facturas cada 15 minutos
- Sincronización manual con un solo clic
- Interfaz de usuario simple y fácil de usar
- Integración con la API de Azur para el SRI Ecuador

## Requisitos

- Node.js v14.0.0 o superior
- NPM v6.0.0 o superior
- Una cuenta de Loyverse con acceso a la API
- Una cuenta de Azur para la facturación electrónica en el SRI

## Instalación

1. Clonar el repositorio:
   ```
   git clone <url-del-repositorio>
   cd loyverse-sri-integration
   ```

2. Instalar dependencias del servidor:
   ```
   npm install
   ```

3. Instalar dependencias del cliente:
   ```
   cd client
   npm install
   cd ..
   ```

4. Crear archivo `.env` a partir del ejemplo:
   ```
   cp .env.example .env
   ```

5. Editar el archivo `.env` y agregar la clave de API de Azur:
   ```
   AZUR_API_KEY=tu_clave_api_de_azur
   ```

## Configuración

### Obtener token de Loyverse

1. Inicia sesión en el Back Office de Loyverse
2. Ve a la sección "Access Tokens"
3. Haz clic en "+ Add access token"
4. Ingresa un nombre para el token y establece una fecha de expiración si es necesario
5. Haz clic en "Save" y copia el token generado

### Configurar la aplicación

1. Inicia la aplicación (ver instrucciones a continuación)
2. Ingresa el token de Loyverse en el formulario de la página principal
3. Haz clic en "Guardar Token"

## Uso

### Desarrollo

Para ejecutar la aplicación en modo desarrollo:

```
npm run dev-full
```

Esto iniciará tanto el servidor backend como el cliente frontend.

### Producción

Para preparar la aplicación para producción:

1. Construir el cliente:
   ```
   npm run build
   ```

2. Iniciar el servidor:
   ```
   npm start
   ```

## Funcionamiento

La aplicación realiza las siguientes acciones:

1. Autentica con Loyverse usando el token proporcionado
2. Consulta periódicamente las nuevas facturas de Loyverse
3. Convierte las facturas de Loyverse al formato requerido por el SRI
4. Envía las facturas al SRI a través de la API de Azur
5. Muestra el estado de la sincronización en la interfaz de usuario

## Personalización

### Datos de la empresa

Para personalizar los datos de la empresa que se envían al SRI, edita la función `formatReceiptForSRI` en el archivo `services.js` y actualiza los campos correspondientes.

### Intervalo de sincronización

Para cambiar el intervalo de sincronización automática, edita la programación cron en el archivo `server.js`. Por defecto, la sincronización se realiza cada 15 minutos.

## Soporte

Para obtener ayuda o reportar problemas, por favor contacta al desarrollador.

## Licencia

MIT
