import { pool } from '../database/connection.js';
import { procesarFiltroConIA, procesarDocumentacionConIA, transcribirAudio, analizarDocumentoMultimodal } from './openai.js';
import { obtenerEstadoBotPorTelefono, pausarBotPorTelefono, reactivarBotPorTelefono, guardarDocumentoAnalizadoEnExpediente } from './dbQueries.js';
import { enviarMensajeConBotones } from './whatsapp.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { enviarAlertaTelegram } from './telegram.js';
import fs from 'fs';
import path from 'path';

const DOWNLOADS_DIR = path.join(process.cwd(), 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function normalizarTelefono(jid) {
    return jid
        .replace(/@.*$/, '')
        .replace(/\D/g, '');
}

// ⏳ Acumuladores globales en memoria para la ventana de espera (Debounce)
const ventanasEspera = {};
const documentosAcumulados = {};

/**
 * Simula escritura humana en WhatsApp:
 * activa "Escribiendo..." y genera un delay proporcional al largo del texto.
 */
async function enviarConEfectoHumano(sock, remoteJid, texto) {
    try {
        await sock.sendPresenceUpdate('composing', remoteJid);
        const delayInMs = Math.min(Math.max(texto.length * 25, 1500), 4500);
        await new Promise(resolve => setTimeout(resolve, delayInMs));
        const mensajeEnviado = await sock.sendMessage(remoteJid, { text: texto });
        await sock.sendPresenceUpdate('paused', remoteJid);
        return mensajeEnviado;
    } catch (error) {
        console.error('❌ Error en el simulador de escritura humana:', error);
        return await sock.sendMessage(remoteJid, { text: texto });
    }
}

/**
 * 🔘 Procesa respuesta de IA y decide si enviar botones o texto plano
 * 
 * Esperado: La IA devuelve JSON con estructura:
 * {
 *   "respuesta_usuario": "Texto de la pregunta",
 *   "botones": ["Opción 1", "Opción 2", "Opción 3"]
 * }
 * 
 * Si botones está vacío → Envía texto plano con efecto humano
 * Si botones tiene elementos → Envía mensaje interactivo con botones
 */
async function procesarRespuestaConBotones(sock, remoteJid, respuestaIA) {
    try {
        let respuesta_usuario = '';
        let botones = [];

        // ╔════════════════════════════════════════════════════════════════╗
        // ║ 📦 PARSEO: Intentar extraer JSON de la respuesta de la IA     ║
        // ║    Maneja tanto respuestas JSON como texto plano              ║
        // ╚════════════════════════════════════════════════════════════════╝
        if (typeof respuestaIA === 'string') {
            try {
                // Intentar parsear como JSON
                const jsonParsado = JSON.parse(respuestaIA);
                respuesta_usuario = jsonParsado.respuesta_usuario || '';
                botones = Array.isArray(jsonParsado.botones) ? jsonParsado.botones : [];
                console.log(`✅ Respuesta de IA parseada como JSON. Botones: ${botones.length}`);
            } catch (parseError) {
                // Si no es JSON válido, tratar como texto plano
                respuesta_usuario = respuestaIA;
                botones = [];
                console.log(`ℹ️ Respuesta de IA no es JSON válido, enviando como texto plano.`);
            }
        } else if (typeof respuestaIA === 'object' && respuestaIA !== null) {
            // Ya es un objeto parseado
            respuesta_usuario = respuestaIA.respuesta_usuario || '';
            botones = Array.isArray(respuestaIA.botones) ? respuestaIA.botones : [];
        }

        // ╔════════════════════════════════════════════════════════════════╗
        // ║ 🎯 LÓGICA DE ENVÍO: Con botones o sin botones                 ║
        // ╚════════════════════════════════════════════════════════════════╝
        if (botones.length > 0) {
            // ✅ Con botones interactivos
            console.log(`🔘 Enviando respuesta con ${botones.length} botones.`);
            await enviarMensajeConBotones(sock, remoteJid, respuesta_usuario, botones);
        } else {
            // ✅ Sin botones (texto plano con efecto humano)
            console.log(`📝 Enviando respuesta como texto plano.`);
            await enviarConEfectoHumano(sock, remoteJid, respuesta_usuario);
        }

        return { respuesta_usuario, botones };

    } catch (error) {
        console.error('❌ Error en procesarRespuestaConBotones:', error);
        // Fallback: enviar respuesta como texto plano
        await enviarConEfectoHumano(sock, remoteJid, typeof respuestaIA === 'string' ? respuestaIA : JSON.stringify(respuestaIA));
        return { respuesta_usuario: typeof respuestaIA === 'string' ? respuestaIA : JSON.stringify(respuestaIA), botones: [] };
    }
}

export async function manejarMensajeEntrante(sock, msg) {
    try {
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        const deMi = msg.key.fromMe;
        if (isGroup || deMi) return;

        const remoteJid = msg.key.remoteJid;
        const telefono = normalizarTelefono(remoteJid);

        const messageContent = msg.message;
        if (!messageContent) return;

        // ╔════════════════════════════════════════════════════════════════╗
        // ║ 🚩 FILTRO DE PAUSA: Si el bot está pausado para este lead     ║
        // ║    ignorar el mensaje silenciosamente (control humano activo)  ║
        // ╚════════════════════════════════════════════════════════════════╝
        const estadoBot = await obtenerEstadoBotPorTelefono(telefono);
        if (estadoBot.encontrado && !estadoBot.botActivo) {
            console.log(`🔇 [${telefono}] Bot pausado. Motivo: ${estadoBot.pauseReason}. Mensaje ignorado.`);
            return;
        }

        let tipoMensaje = 'text';
        let textoUsuario = messageContent.conversation || messageContent.extendedTextMessage?.text;
        let mediaMessage = null;
        let extensionElegida = '';

        // ╔════════════════════════════════════════════════════════════════╗
        // ║ 🔘 CAPTURA UNIFICADA DE BOTONES Y TEXTO                       ║
        // ║    Extrae transparentemente clics de botones o texto libre     ║
        // ╚════════════════════════════════════════════════════════════════╝
        if (messageContent.buttonsResponseMessage) {
            // Usuario presionó un botón interactivo
            tipoMensaje = 'button_click';
            textoUsuario = messageContent.buttonsResponseMessage.selectedButtonText || '[Botón sin texto]';
            console.log(`🔘 Clic en botón detectado: "${textoUsuario}"`);
        } else if (messageContent.imageMessage) {
            tipoMensaje = 'image';
            mediaMessage = messageContent.imageMessage;
            extensionElegida = '.jpg';
            textoUsuario = messageContent.imageMessage.caption || '[Imagen de WhatsApp]';
        } else if (messageContent.documentMessage) {
            tipoMensaje = 'document';
            mediaMessage = messageContent.documentMessage;
            const originalName = messageContent.documentMessage.fileName || '';
            extensionElegida = path.extname(originalName) || '.pdf';
            textoUsuario = originalName || '[Documento Adjunto]';
        } else if (messageContent.audioMessage) {
            tipoMensaje = 'audio';
            mediaMessage = messageContent.audioMessage;
            extensionElegida = '.ogg';
            textoUsuario = '[Nota de Voz]';
        }

        if (tipoMensaje === 'text' && !textoUsuario) return;

        // ╔════════════════════════════════════════════════════════════════╗
        // ║ 🎛️  COMANDOS DE CONTROL: Asesor cambia estado del bot        ║
        // ║    .humano  → Pausar bot, asesor toma control                  ║
        // ║    .bot     → Reactivar bot                                    ║
        // ╚════════════════════════════════════════════════════════════════╝
        if (tipoMensaje === 'text' && textoUsuario?.toLowerCase() === '.humano') {
            await pausarBotPorTelefono(telefono, 'asesor_intervino');
            console.log(`🧑‍💼 Comando .humano detectado. Asesor tomó control para ${telefono}`);
            return;
        }

        if (tipoMensaje === 'text' && textoUsuario?.toLowerCase() === '.bot') {
            await reactivarBotPorTelefono(telefono);
            console.log(`🤖 Comando .bot detectado. Bot reactivado para ${telefono}`);
            // Enviar confirmación al asesor
            await enviarConEfectoHumano(sock, remoteJid, "✅ Bot reactivado. Vuelvo a responder automáticamente.");
            return;
        }

        // ── Buscar o registrar el Lead en MySQL ───────────────────────────────
        console.log(`🔎 Buscando lead con teléfono normalizado: ${telefono}`);
        let [leads] = await pool.query(
            'SELECT id, status FROM leads WHERE REPLACE(REPLACE(phone, "+", ""), " ", "") = ?;',
            [telefono]
        );
        let leadId;
        let estadoActual;

        if (leads.length === 0) {
            console.log(`➕ No existe lead previo para ${telefono}. Creando nuevo registro.`);
            const [resultado] = await pool.query(
                'INSERT INTO leads (phone, status) VALUES (?, \'filtrado\')',
                [telefono]
            );
            leadId = resultado.insertId;
            estadoActual = 'filtrado';
            console.log(`✨ Nuevo lead indexado en MySQL. ID: ${leadId}`);
        } else {
            leadId = leads[0].id;
            estadoActual = leads[0].status;
        }

        // ── Descarga física de archivos y transcripción de audio ─────────────
        let rutaArchivoLocal = null;
        if (mediaMessage) {
            console.log(`⏳ Descargando archivo [${tipoMensaje}] para Lead ID ${leadId}...`);
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                const nombreArchivo = `lead_${leadId}_${Date.now()}${extensionElegida}`;
                rutaArchivoLocal = path.join(DOWNLOADS_DIR, nombreArchivo);
                fs.writeFileSync(rutaArchivoLocal, buffer);
                console.log(`💾 Archivo guardado: downloads/${nombreArchivo}`);

                if (tipoMensaje === 'audio') {
                    console.log(`🎙️ Transcribiendo nota de voz del Lead ID ${leadId}...`);
                    const transcripcion = await transcribirAudio(rutaArchivoLocal);
                    console.log(`📝 Transcripción: ${transcripcion}`);
                    textoUsuario = transcripcion;
                    // El audio transcrito entra al flujo conversacional como texto
                    tipoMensaje = 'text';
                }

            } catch (downloadError) {
                console.error('❌ Error al procesar archivo multimedia:', downloadError);
                await enviarConEfectoHumano(
                    sock, remoteJid,
                    "Disculpa, tuve un problema técnico al procesar tu archivo. ¿Podrías enviarlo de nuevo?"
                );
                return;
            }
        }

        // ── Guardar mensaje del usuario en historial ─────────────────────────
        await pool.query(
            'INSERT INTO chat_history (lead_id, sender, message_type, message, file_path) VALUES (?, "user", ?, ?, ?)',
            [leadId, tipoMensaje, textoUsuario, rutaArchivoLocal]
        );

        console.log(`\n📩 [${telefono}] Estado: ${estadoActual} | Tipo: ${tipoMensaje} | Msg: ${textoUsuario}`);

        // =====================================================================
        // MÁQUINA DE ESTADOS DEL AGENTE CONVERSACIONAL
        // =====================================================================

        // ── ESTADO: filtrado ──────────────────────────────────────────────────
        if (estadoActual === 'filtrado') {

            // Si envía archivo antes de completar el filtro, redirigir a texto
            if (tipoMensaje !== 'text') {
                const respuestaFiltroMedia = "¡Hola! Veo que me enviaste un archivo, pero antes de revisar tus documentos, me gustaría hacerte un par de preguntas rápidas para entender mejor tu situación. Cuéntame brevemente, ¿cómo y dónde ocurrió el accidente?";
                await enviarConEfectoHumano(sock, remoteJid, respuestaFiltroMedia);
                await pool.query(
                    'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                    [leadId, respuestaFiltroMedia]
                );
                return;
            }

            const [historialFilas] = await pool.query(
                'SELECT sender, message FROM chat_history WHERE lead_id = ? ORDER BY created_at ASC LIMIT 25',
                [leadId]
            );

            console.log(`🧠 Consultando a Sofía (IA) para Lead ID: ${leadId}...`);
            const resultadoIA = await procesarFiltroConIA(historialFilas);

            // ── Caso excluido por prescripción de tiempo ──────────────────────
            //
            // POR QUÉ SE REGISTRA EN MySQL:
            // Si no persistimos este estado, cuando el lead vuelva a escribir
            // (hoy, mañana o en una semana) el bot lo encontrará en 'filtrado'
            // y repetirá todo el proceso de calificación desde cero, haciéndole
            // las mismas preguntas a alguien que ya fue descartado. Con el estado
            // 'excluido_tiempo' en la tabla, el bot detecta la exclusión y
            // responde directamente sin volver a calificar.
            // Adicionalmente, este registro permite medir en el embudo cuántos
            // leads llegan fuera del rango temporal, dato clave para optimizar
            // la fuente de captación.
            if (resultadoIA.casoExcluidoPorTiempo) {
                await pool.query(
                    'UPDATE leads SET status = "excluido_tiempo", updated_at = NOW() WHERE id = ?',
                    [leadId]
                );
                console.log(`⏱️ Lead ID ${leadId} excluido por prescripción de tiempo. Estado → excluido_tiempo`);

                // Alerta Telegram para que el equipo tenga trazabilidad del descarte
                const alertaExcluido = `
⏱️ <b>LEAD EXCLUIDO — CASO FUERA DE RANGO TEMPORAL</b>
--------------------------------------------------
👤 <b>Lead ID:</b> ${leadId}
📱 <b>Teléfono:</b> +${telefono}
🕐 <b>Momento:</b> ${new Date().toLocaleString('es-CO')}

❌ <b>Motivo:</b> El accidente ocurrió hace más de 18 meses. Caso fuera del parámetro de viabilidad legal de la firma.

🤖 <b>Mensaje de cierre enviado al usuario:</b>
<i>"${resultadoIA.respuesta}"</i>
--------------------------------------------------`;

                enviarAlertaTelegram(alertaExcluido).catch(err =>
                    console.error('⚠️ Falló envío a Telegram (exclusión tiempo):', err)
                );
            }

            // ╔════════════════════════════════════════════════════════════════╗
            // ║ 🔘 ENVÍO DINÁMICO: Procesa respuesta (texto + botones)        ║
            // ║    La IA puede devolver JSON con botones o texto plano        ║
            // ╚════════════════════════════════════════════════════════════════╝
            const { respuesta_usuario: respuestaFinal } = await procesarRespuestaConBotones(
                sock,
                remoteJid,
                resultadoIA.respuesta
            );

            // Guardar en historial (siempre guardamos la respuesta de texto, no los botones)
            await pool.query(
                'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                [leadId, respuestaFinal]
            );

            // ── Transición a documentación ────────────────────────────────────
            if (resultadoIA.cambiarEstado === 'documentacion') {
                await pool.query(
                    'UPDATE leads SET status = "documentacion", updated_at = NOW() WHERE id = ?',
                    [leadId]
                );
                console.log(`🚀 Lead ID ${leadId} CALIFICADO. Estado → documentacion`);

                const testimonioCompleto = historialFilas
                    .filter(fila => fila.sender === 'user')
                    .map(fila => `• <i>${fila.message}</i>`)
                    .join('\n\n');

                const alertaLeadCalificado = `
🚨 <b>¡NUEVO CASE CALIFICADO PARA REVISIÓN JURÍDICA!</b> 🚨
--------------------------------------------------
👤 <b>Lead ID:</b> ${leadId}
📱 <b>Teléfono:</b> +${telefono}
💼 <b>Pipeline:</b> Esperando Documentación

📋 <b>RELATO COMPLETO MANIFESTADO POR EL USUARIO:</b>
${testimonioCompleto}

🤖 <b>DICTAMEN DE CONVERSIÓN (SOFÍA):</b>
<i>"${resultadoIA.respuesta}"</i>

🎯 <b>Estado del Bot:</b> Se le solicitó exitosamente Croquis e Historia Clínica.
--------------------------------------------------`;

                enviarAlertaTelegram(alertaLeadCalificado).catch(err =>
                    console.error('⚠️ Falló envío a Telegram (lead calificado):', err)
                );

                const mensajeTransicion = "Perfecto. Para proceder a evaluar formalmente la viabilidad jurídica de tu reclamación y radicarla ante la aseguradora o tránsito, por favor envíame por este medio fotos claras o archivos PDF de los siguientes documentos:\n\n1. Croquis o informe de tránsito del accidente.\n2. Epicrisis o Historia clínica preliminar de las lesiones.";
                await enviarConEfectoHumano(sock, remoteJid, mensajeTransicion);
                await pool.query(
                    'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                    [leadId, mensajeTransicion]
                );
            }

        // ── ESTADO: documentacion ─────────────────────────────────────────────
        } else if (estadoActual === 'documentacion') {

            // ╔════════════════════════════════════════════════════════════════╗
            // ║ 🚩 AUTO-PAUSA: Si se reciben documentos, pausar el bot        ║
            // ║    Un asesor debe revisar manualmente los archivos enviados   ║
            // ╚════════════════════════════════════════════════════════════════╝
            if (tipoMensaje === 'image' || tipoMensaje === 'document') {
                console.log(`📄 Archivo recibido en fase documental para Lead ID ${leadId}. Verificando auto-pausa...`);

                // Guardar el archivo en la BD antes de pausar
                await pool.query(
                    'INSERT INTO chat_history (lead_id, sender, message_type, message, file_path) VALUES (?, "user", ?, ?, ?)',
                    [leadId, tipoMensaje, textoUsuario, rutaArchivoLocal]
                );

                // Pausar automáticamente el bot
                await pausarBotPorTelefono(telefono, 'documento_recibido');
                console.log(`⏸️  Auto-pausa activada. Lead ID ${leadId} requiere revisión manual de documentos.`);

                // Enviar mensaje de confirmación cordial
                const mensajePausa = "¡Perfecto! He recibido tus documentos y los estoy indexando en tu expediente. Un asesor revisará toda la información y se pondrá en contacto contigo en breve para validar tu caso. Gracias por tu paciencia.";
                await enviarConEfectoHumano(sock, remoteJid, mensajePausa);
                await pool.query(
                    'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                    [leadId, mensajePausa]
                );

                // ╔════════════════════════════════════════════════════════════════╗
                // ║ 📋 PIPELINE MULTIMODAL: Analizar documento con OpenAI        ║
                // ║    Clasificación, extracción de entidades y viabilidad       ║
                // ╚════════════════════════════════════════════════════════════════╝
                try {
                    console.log(`🧠 Iniciando análisis multimodal para Lead ID ${leadId}...`);
                    
                    // Determinar MIME type según extensión
                    let mimeType = 'application/octet-stream';
                    if (tipoMensaje === 'image') {
                        mimeType = extensionElegida === '.jpg' ? 'image/jpeg' : 'image/png';
                    } else if (tipoMensaje === 'document') {
                        mimeType = 'application/pdf';
                    }

                    // Procesar documento con OpenAI
                    const analisisMultimodal = await analizarDocumentoMultimodal(rutaArchivoLocal, mimeType);

                    // Guardar los resultados en la BD
                    const docGuardado = await guardarDocumentoAnalizadoEnExpediente(
                        leadId,
                        rutaArchivoLocal,
                        analisisMultimodal.tipo_documento,
                        analisisMultimodal
                    );

                    console.log(`✅ Documento analizado y guardado. Tipo: ${analisisMultimodal.tipo_documento}`);

                    // Enviar alerta enriquecida a Telegram con análisis
                    const alertaDocumentosAnalizado = `
📂 <b>DOCUMENTO ANALIZADO — PAUSA AUTOMÁTICA ACTIVADA</b> 📂
--------------------------------------------------
👤 <b>Lead ID:</b> ${leadId}
📱 <b>Teléfono:</b> +${telefono}
📊 <b>Tipo de archivo:</b> ${tipoMensaje}
📄 <b>Nombre:</b> ${textoUsuario}

🤖 <b>ANÁLISIS DE IA:</b>
🏷️ <b>Tipo de Documento:</b> <code>${analisisMultimodal.tipo_documento}</code>
📝 <b>Resumen Ejecutivo:</b>
<i>${analisisMultimodal.resumen_ejecutivo}</i>

🔑 <b>Entidades Clave Detectadas:</b>
${Object.entries(analisisMultimodal.entidades_clave || {})
    .filter(([_, valores]) => valores.length > 0)
    .map(([clave, valores]) => `• <b>${clave}:</b> ${valores.join(', ')}`)
    .join('\n') || 'Ninguna detectada'}

✅ <b>Caso Viable:</b> ${analisisMultimodal.caso_viable ? 'Sí ✓' : 'Requiere revisión jurídica'}

✋ <b>Estado:</b> Bot pausado automáticamente. Requiere revisión manual.
🔗 <b>Ruta del archivo:</b> ${rutaArchivoLocal}

📋 <b>Acción requerida:</b> Equipo legal debe revisar y validar los documentos.
--------------------------------------------------`;

                    enviarAlertaTelegram(alertaDocumentosAnalizado).catch(err =>
                        console.error('⚠️ Falló envío a Telegram (análisis de documento):', err)
                    );

                } catch (analisiaError) {
                    console.error('❌ Error en análisis multimodal:', analisiaError);
                    
                    // Alerta de error sin detener el flujo
                    const alertaErrorAnalisis = `
⚠️ <b>ERROR EN ANÁLISIS MULTIMODAL</b> ⚠️
--------------------------------------------------
👤 <b>Lead ID:</b> ${leadId}
📱 <b>Teléfono:</b> +${telefono}

❌ <b>Error:</b> ${analisiaError.message}

El documento se guardó pero no pudo analizarse automáticamente.
Equipo legal debe revisar manualmente.
--------------------------------------------------`;
                    
                    enviarAlertaTelegram(alertaErrorAnalisis).catch(err =>
                        console.error('⚠️ Falló envío a Telegram (error análisis):', err)
                    );
                }

                return; // 🛑 Cortamos la ejecución, no procesar más

            }

            // ── Texto en fase documentación: agente Q&A ───────────────────────
            if (tipoMensaje === 'text') {

                console.log(`💬 Texto en fase documentacion para Lead ID ${leadId}. Consultando agente Q&A...`);

                const [docsIndexados] = await pool.query(
                    'SELECT file_name, document_type FROM lead_documents WHERE lead_id = ?',
                    [leadId]
                );

                const [historialFilas] = await pool.query(
                    'SELECT sender, message FROM chat_history WHERE lead_id = ? ORDER BY created_at ASC LIMIT 25',
                    [leadId]
                );

                const resultadoDoc = await procesarDocumentacionConIA(historialFilas, docsIndexados);

                // ── Handoff: el abogado toma control ─────────────────────────
                //
                // POR QUÉ SE REGISTRA EN MySQL:
                // Sin este UPDATE, si el abogado ya está atendiendo al usuario
                // y el lead escribe un mensaje, el bot respondería encima del
                // abogado, generando confusión y pareciendo poco profesional.
                // Al persistir el estado 'remitido', el bot se silencia de forma
                // permanente para ese lead en todos los mensajes futuros,
                // sin importar reinicios del servidor.
                if (resultadoDoc.cederControl) {
                    await pool.query(
                        'UPDATE leads SET status = "remitido", updated_at = NOW() WHERE id = ?',
                        [leadId]
                    );
                    console.log(`🤝 Lead ID ${leadId} → estado "remitido". Bot silenciado, abogado activo.`);

                    const alertaHandoff = `
🤝 <b>HANDOFF ACTIVADO — ABOGADO AL CONTROL</b>
--------------------------------------------------
👤 <b>Lead ID:</b> ${leadId}
📱 <b>Teléfono:</b> +${telefono}
🕐 <b>Momento:</b> ${new Date().toLocaleString('es-CO')}

ℹ️ El usuario confirmó que el abogado ya tomó contacto.
El bot se ha silenciado automáticamente.
--------------------------------------------------`;

                    enviarAlertaTelegram(alertaHandoff).catch(err =>
                        console.error('⚠️ Falló envío a Telegram (handoff):', err)
                    );
                    return;
                }

                // ╔════════════════════════════════════════════════════════════════╗
                // ║ 🔘 ENVÍO DINÁMICO: Respuesta de documentación con botones     ║
                // ╚════════════════════════════════════════════════════════════════╝
                const { respuesta_usuario: respuestaDocFinal } = await procesarRespuestaConBotones(
                    sock,
                    remoteJid,
                    resultadoDoc.respuesta
                );

                await pool.query(
                    'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                    [leadId, respuestaDocFinal]
                );
            }

        // ── ESTADO: remitido — bot silenciado, abogado activo ─────────────────
        //
        // POR QUÉ SE REGISTRA EN MySQL Y POR QUÉ EL BOT NO RESPONDE:
        // El abogado tomó el control de la conversación. Si el bot respondiera,
        // interferiría con el seguimiento jurídico y rompería la confianza del
        // usuario que ya está hablando con una persona real.
        // Para reactivar el bot manualmente si el abogado termina:
        //   UPDATE leads SET status = 'documentacion' WHERE phone = '57XXXXXXXXXX';
        } else if (estadoActual === 'remitido') {
            console.log(`🔕 Lead ID ${leadId} → "remitido". Abogado activo. Mensaje ignorado.`);

        // ── ESTADO: excluido_tiempo — bot silenciado, caso descartado ─────────
        //
        // POR QUÉ SE REGISTRA EN MySQL Y POR QUÉ EL BOT NO RESPONDE:
        // El caso fue descartado por prescripción de tiempo en una conversación
        // anterior. Si el bot respondiera, volvería a calificar al usuario desde
        // cero, repitiendo todo el proceso y generando una experiencia confusa.
        // Al detectar este estado, el bot simplemente no responde.
        // Si en el futuro se quiere reabrir el caso manualmente (decisión del
        // equipo jurídico), basta con:
        //   UPDATE leads SET status = 'filtrado' WHERE phone = '57XXXXXXXXXX';
        } else if (estadoActual === 'excluido_tiempo') {
            console.log(`⏱️ Lead ID ${leadId} → "excluido_tiempo". Caso descartado previamente. Mensaje ignorado.`);

        } else {
            console.log(`🔕 Lead ID ${leadId} → estado desconocido: "${estadoActual}". Ignorando.`);
        }

    } catch (error) {
        console.error('❌ Error crítico en el flujo de ejecución del mensaje:', error);
    }
}