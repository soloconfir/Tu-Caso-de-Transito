import { pool } from '../database/connection.js';

/**
 * 🔌 1. VERIFICAR ESTADO DE LA SESIÓN DE WHATSAPP
 * Retorna si existe una sesión activa y su tamaño en la base de datos.
 */
export async function obtenerEstadoSesion() {
    try {
        const query = 'SELECT id, LENGTH(data) AS tamano_bytes FROM whatsapp_sessions;';
        const [filas] = await pool.query(query);
        
        if (filas.length === 0) {
            return { activa: false, mensaje: "No hay ninguna sesión de WhatsApp guardada en la base de datos." };
        }
        
        return {
            activa: true,
            sesiones: filas.map(f => ({
                id: f.id,
                tamanoKB: (f.tamano_bytes / 1024).toFixed(2) + ' KB'
            }))
        };
    } catch (error) {
        console.error('❌ Error al consultar la sesión de WhatsApp:', error);
        throw error;
    }
}

/**
 * 👤 2. OBTENER INFORMACIÓN DE UN LEAD Y SU HISTORIAL DE CHATS
 * Trae los datos del prospecto junto con toda su conversación ordenada cronológicamente.
 */
export async function obtenerHistorialPorTelefono(telefono) {
    try {
        // Primero buscamos si el lead existe
        const queryLead = 'SELECT id, phone, name, status, created_at FROM leads WHERE phone = ?';
        const [leads] = await pool.query(queryLead, [telefono]);

        if (leads.length === 0) {
            return { encontrado: false, mensaje: `No se encontró ningún lead con el teléfono ${telefono}` };
        }

        const lead = leads[0];

        // Traemos su historial de chats uniendo las tablas
        const queryHistorial = `
            SELECT sender, message_type, message, file_path, created_at 
            FROM chat_history 
            WHERE lead_id = ? 
            ORDER BY created_at ASC
        `;
        const [historial] = await pool.query(queryHistorial, [lead.id]);

        return {
            encontrado: true,
            lead: {
                id: lead.id,
                telefono: lead.phone,
                nombre: lead.name || 'Sin registrar',
                estadoActual: lead.status,
                fechaRegistro: lead.created_at
            },
            totalMensajes: historial.length,
            conversacion: historial
        };
    } catch (error) {
        console.error(`❌ Error al empaquetar el historial del teléfono ${telefono}:`, error);
        throw error;
    }
}

/**
 * 📊 3. OBTENER MÉTRICAS DEL PIPELINE DE LEADS
 * Cuenta cuántos leads hay actualmente en cada estado ('filtrado', 'documentacion', 'remitido').
 */
export async function obtenerMetricasPipeline() {
    try {
        const query = 'SELECT status, COUNT(*) AS total FROM leads GROUP BY status';
        const [filas] = await pool.query(query);
        
        // Mapeamos el resultado a un objeto limpio
        const metricas = { filtrado: 0, documentacion: 0, remitido: 0 };
        filas.forEach(f => {
            metricas[f.status] = f.total;
        });
        
        return metricas;
    } catch (error) {
        console.error('❌ Error al obtener métricas del pipeline:', error);
        throw error;
    }
}