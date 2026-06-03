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

/**
 * 🚩 4. OBTENER ESTADO DEL BOT PARA UN LEAD
 * Consulta si el bot está activo (bot_active) y el motivo de pausa si está inactivo.
 * Retorna: { botActivo: boolean, pauseReason: string|null, estado: string, leadId: int }
 */
export async function obtenerEstadoBotPorTelefono(telefono) {
    try {
        const query = `
            SELECT id, bot_active, pause_reason, status 
            FROM leads 
            WHERE REPLACE(REPLACE(phone, "+", ""), " ", "") = ?
        `;
        const [filas] = await pool.query(query, [telefono]);
        
        if (filas.length === 0) {
            return { encontrado: false, mensaje: `No se encontró lead con teléfono ${telefono}` };
        }
        
        const lead = filas[0];
        return {
            encontrado: true,
            leadId: lead.id,
            botActivo: lead.bot_active === 1,
            pauseReason: lead.pause_reason,
            estado: lead.status
        };
    } catch (error) {
        console.error(`❌ Error consultando estado del bot para ${telefono}:`, error);
        throw error;
    }
}

/**
 * ⏸️ 5. PAUSAR BOT PARA UN LEAD
 * Actualiza bot_active = 0 y registra el motivo de la pausa.
 */
export async function pausarBotPorTelefono(telefono, pauseReason = 'pausa_manual') {
    try {
        const query = `
            UPDATE leads 
            SET bot_active = 0, pause_reason = ?, updated_at = NOW() 
            WHERE REPLACE(REPLACE(phone, "+", ""), " ", "") = ?
        `;
        const [resultado] = await pool.query(query, [pauseReason, telefono]);
        
        if (resultado.affectedRows === 0) {
            return { exito: false, mensaje: `No se encontró lead con teléfono ${telefono}` };
        }
        
        console.log(`⏸️  Bot pausado para ${telefono}. Motivo: ${pauseReason}`);
        return { exito: true, telefono, pauseReason };
    } catch (error) {
        console.error(`❌ Error al pausar el bot para ${telefono}:`, error);
        throw error;
    }
}

/**
 * ▶️ 6. REACTIVAR BOT PARA UN LEAD
 * Actualiza bot_active = 1 y limpia pause_reason.
 */
export async function reactivarBotPorTelefono(telefono) {
    try {
        const query = `
            UPDATE leads 
            SET bot_active = 1, pause_reason = NULL, updated_at = NOW() 
            WHERE REPLACE(REPLACE(phone, "+", ""), " ", "") = ?
        `;
        const [resultado] = await pool.query(query, [telefono]);
        
        if (resultado.affectedRows === 0) {
            return { exito: false, mensaje: `No se encontró lead con teléfono ${telefono}` };
        }
        
        console.log(`▶️  Bot reactivado para ${telefono}`);
        return { exito: true, telefono };
    } catch (error) {
        console.error(`❌ Error al reactivar el bot para ${telefono}:`, error);
        throw error;
    }
}

/**
 * 📄 7. GUARDAR DOCUMENTO ANALIZADO EN EXPEDIENTE
 * Inserta el resultado del análisis multimodal en la tabla lead_documents.
 * 
 * @param {number} leadId - ID del lead
 * @param {string} fileName - Ruta física del archivo guardado
 * @param {string} documentType - Tipo clasificado (Croquis, Cédula, Historia Clínica, etc.)
 * @param {Object} aiAnalysis - Objeto con los resultados del análisis de IA
 * @returns {Promise<Object>} { exito: boolean, documentoId: int }
 */
export async function guardarDocumentoAnalizadoEnExpediente(leadId, fileName, documentType, aiAnalysis) {
    try {
        // Crear un JSON limpio para guardar en la BD
        const resumenAI = JSON.stringify({
            tipo_documento: aiAnalysis.tipo_documento,
            entidades_clave: aiAnalysis.entidades_clave,
            resumen_ejecutivo: aiAnalysis.resumen_ejecutivo,
            caso_viable: aiAnalysis.caso_viable,
            analizado_en: aiAnalysis.timestamp
        });

        const query = `
            INSERT INTO lead_documents (lead_id, file_name, document_type, ai_summary)
            VALUES (?, ?, ?, ?)
        `;
        const [resultado] = await pool.query(query, [leadId, fileName, documentType, resumenAI]);

        console.log(`✅ Documento indexado en BD. Lead ID: ${leadId}, Documento ID: ${resultado.insertId}`);
        
        return { 
            exito: true, 
            documentoId: resultado.insertId,
            leadId,
            tipo: documentType
        };

    } catch (error) {
        console.error(`❌ Error guardando documento en BD (Lead ID ${leadId}):`, error);
        throw error;
    }
}

/**
 * 📊 8. OBTENER DOCUMENTOS INDEXADOS DE UN LEAD
 * Retorna todos los documentos analizados para un lead específico.
 */
export async function obtenerDocumentosDelLead(leadId) {
    try {
        const query = `
            SELECT id, file_name, document_type, ai_summary, created_at
            FROM lead_documents
            WHERE lead_id = ?
            ORDER BY created_at DESC
        `;
        const [docs] = await pool.query(query, [leadId]);
        
        return {
            encontrado: docs.length > 0,
            total: docs.length,
            documentos: docs.map(doc => ({
                id: doc.id,
                archivo: doc.file_name,
                tipo: doc.document_type,
                resumen: doc.ai_summary ? JSON.parse(doc.ai_summary) : null,
                cargadoEn: doc.created_at
            }))
        };
    } catch (error) {
        console.error(`❌ Error obteniendo documentos del lead ${leadId}:`, error);
        throw error;
    }
}