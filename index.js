import { iniciarAgenteWhatsApp } from './src/services/whatsapp.js';
import { pool } from './src/database/connection.js';

/**
 * 🔍 FUNCIÓN DE AUDITORÍA: Consulta la información de la sesión y del pipeline
 * directamente desde la base de datos MySQL.
 */
async function ejecutarAuditoriaInicial() {
    console.log('\n======================================================');
    console.log('🔍 INICIANDO AUDITORÍA INTERNA DE BASE DE DATOS...    ');
    console.log('======================================================');

    try {
        // 1. Consultar el estado y peso de la sesión de WhatsApp
        const querySesion = 'SELECT id, LENGTH(data) AS tamano_bytes FROM whatsapp_sessions;';
        const [sesiones] = await pool.query(querySesion);
        
        if (sesiones.length === 0) {
            console.log('📱 Sesión de WhatsApp: ❌ No se encontraron credenciales previas en DB.');
        } else {
            console.log(`📱 Sesión de WhatsApp: ✅ Activa (${sesiones.length} registro(s) en base de datos).`);
            sesiones.forEach(s => {
                const tamanoKB = (s.tamano_bytes / 1024).toFixed(2);
                console.log(`   -> ID Sesión: [${s.id}] | Tamaño en memoria: ${tamanoKB} KB`);
            });
        }

        // 2. Consultar las métricas de conversión del Pipeline de Leads
        const queryPipeline = 'SELECT status, COUNT(*) AS total FROM leads GROUP BY status;';
        const [metricas] = await pool.query(queryPipeline);
        
        const pipeline = { filtrado: 0, documentacion: 0, remitido: 0 };
        metricas.forEach(row => {
            if (pipeline.hasOwnProperty(row.status)) {
                pipeline[row.status] = row.total;
            }
        });

        console.log('📊 Estado del Pipeline de Leads (Métricas de Conversión):');
        console.log(`   -> ⏳ En Fase Diagnóstico (Filtrado): ${pipeline.filtrado}`);
        console.log(`   -> 📂 Cargando Papeles (Documentación): ${pipeline.documentacion}`);
        console.log(`   -> ⚖️ Listos para Abogados (Remitido): ${pipeline.remitido}`);
        console.log('======================================================\n');

    } catch (error) {
        console.error('⚠️ Advertencia en auditoría (No impide el arranque):', error.message);
        console.log('======================================================\n');
    }
}

/**
 * 🚀 FUNCIÓN PRINCIPAL DEL SISTEMA
 */
async function main() {
    try {
        console.log('🚀 Arrancando el Sistema del Agente Conversacional...');
        
        // Ejecutamos la consulta a la base de datos antes de levantar el socket de WhatsApp
        await ejecutarAuditoriaInicial();
        
        // Inicializa el agente conversacional (Sofía) y conecta con Baileys
        await iniciarAgenteWhatsApp();
        
    } catch (error) {
        console.error('❌ Error fatal al iniciar el sistema:', error);
    }
}

main();