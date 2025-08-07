/**
 * Determina el tipo de identificación según el formato del número
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
 * Extrae la identificación fiscal del cliente desde diferentes campos
 */
function extraerIdentificacionCliente(customer) {
    if (!customer) return "9999999999";
    
    // Opción 1: Buscar en customer_code
    if (customer.customer_code && customer.customer_code.trim() !== "") {
        // Si el customer_code parece ser un RUC o cédula (solo números)
        if (/^\d{10,13}$/.test(customer.customer_code.replace(/[^0-9]/g, ''))) {
            return customer.customer_code.replace(/[^0-9]/g, '');
        }
    }
    
    // Opción 2: Buscar en note con formato "RUC: XXXX" o "CEDULA: XXXX"
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
 * Formatea un recibo de Loyverse al formato requerido por SRI
 */
function formatReceiptForSRI(receipt) {
    // Extraer información del cliente
    const customer = receipt.customer || {};
    
    // Extraer identificación fiscal del cliente
    const identificacion = extraerIdentificacionCliente(customer);
    
    // Determinar tipo de identificación
    const tipoIdentificacion = determinarTipoIdentificacion(identificacion);
    
    // Formatear items
    const items = receipt.line_items.map(item => ({
        cantidad: item.quantity,
        codigo_principal: item.item_code || item.variant_id,
        descripcion: item.item_name,
        precio_unitario: item.price,
        descuento: item.discount_amount || 0,
        precio_total_sin_impuestos: item.net_total,
        impuestos: [{
            codigo: "2", // IVA
            codigo_porcentaje: "2", // 12%
            base_imponible: item.net_total,
            valor: item.tax_amount || 0
        }]
    }));

    // Crear objeto de factura para SRI
    return {
        ambiente: "1", // 1: Pruebas, 2: Producción
        tipo_emision: "1", // 1: Normal
        razon_social: "EMPRESA DEMO", // Reemplazar con datos reales
        nombre_comercial: "EMPRESA DEMO", // Reemplazar con datos reales
        ruc: "9999999999001", // Reemplazar con RUC real
        clave_acceso: "", // Se generará automáticamente
        codigo_documento: "01", // 01: Factura
        establecimiento: "001", // Reemplazar con datos reales
        punto_emision: "001", // Reemplazar con datos reales
        secuencial: receipt.receipt_number ? receipt.receipt_number.replace(/\D/g, '').padStart(9, '0').substring(0, 9) : "000000001",
        fecha_emision: new Date(receipt.created_at).toISOString().split('T')[0],
        fecha_expiracion: "", // Opcional
        direccion_establecimiento: "Dirección de la empresa", // Reemplazar con datos reales
        total_sin_impuestos: receipt.total_money && receipt.total_money.net_sales ? receipt.total_money.net_sales : 0,
        total_descuento: receipt.total_money && receipt.total_money.discount ? receipt.total_money.discount : 0,
        propina: 0,
        importe_total: receipt.total_money && receipt.total_money.gross_sales ? receipt.total_money.gross_sales : 0,
        moneda: "DOLAR",
        cliente: {
            razon_social: customer.name || "CONSUMIDOR FINAL",
            identificacion: identificacion,
            tipo_identificacion: tipoIdentificacion,
            direccion: customer.address || "",
            email: customer.email || "",
            telefono: customer.phone_number || ""
        },
        items: items,
        pagos: [
            {
                forma_pago: "01", // 01: Sin utilización del sistema financiero
                total: receipt.total_money && receipt.total_money.gross_sales ? receipt.total_money.gross_sales : 0,
                plazo: "0",
                unidad_tiempo: "dias"
            }
        ]
    };
}
