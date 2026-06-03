import { pool } from '../database/connection.js';
import { procesarFiltroConIA, procesarDocumentacionConIA, transcribirAudio } from './openai.js';
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

export async function manejarMensajeEntrante(sock, msg) {
    try {
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        const deMi = msg.key.fromMe;
        if (isGroup || deMi) return;

        const remoteJid = msg.key.remoteJid;
        const telefono = normalizarTelefono(remoteJid);

        const messageContent = msg.message;
        if (!messageContent) return;

        let tipoMensaje = 'text';
        let textoUsuario = messageContent.conversation || messageContent.extendedTextMessage?.text;
        let mediaMessage = null;
        let extensionElegida = '';

        if (messageContent.imageMessage) {
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

            // Enviar respuesta al usuario (sea exclusión o continuación del filtro)
            await enviarConEfectoHumano(sock, remoteJid, resultadoIA.respuesta);
            await pool.query(
                'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                [leadId, resultadoIA.respuesta]
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

🎯 <b>Estado del Bot:</b> Se le solicitó exitosamente Cédula, Croquis e Historia Clínica.
--------------------------------------------------`;

                enviarAlertaTelegram(alertaLeadCalificado).catch(err =>
                    console.error('⚠️ Falló envío a Telegram (lead calificado):', err)
                );

                const mensajeTransicion = "Perfecto. Para proceder a evaluar formalmente la viabilidad jurídica de tu reclamación y radicarla ante la aseguradora o tránsito, por favor envíame por este medio fotos claras o archivos PDF de los siguientes documentos:\n\n1. Cédula del afectado.\n2. Croquis o informe de tránsito del accidente.\n3. Epicrisis o Historia clínica preliminar de las lesiones.";
                await enviarConEfectoHumano(sock, remoteJid, mensajeTransicion);
                await pool.query(
                    'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                    [leadId, mensajeTransicion]
                );
            }

        // ── ESTADO: documentacion ─────────────────────────────────────────────
        } else if (estadoActual === 'documentacion') {

            // ── Archivos: flujo de debounce ───────────────────────────────────
            if (tipoMensaje === 'image' || tipoMensaje === 'document') {
                console.log(`📄 Archivo recibido en fase documental para Lead ID ${leadId}. Agrupando...`);

                if (!documentosAcumulados[remoteJid]) {
                    documentosAcumulados[remoteJid] = [];
                }
                documentosAcumulados[remoteJid].push({
                    tipo: tipoMensaje,
                    texto: textoUsuario,
                    ruta: rutaArchivoLocal
                });

                if (ventanasEspera[remoteJid]) clearTimeout(ventanasEspera[remoteJid]);

                ventanasEspera[remoteJid] = setTimeout(async () => {
                    try {
                        const paqueteDocs = documentosAcumulados[remoteJid] || [];
                        const cantidadDocs = paqueteDocs.length;

                        delete documentosAcumulados[remoteJid];
                        delete ventanasEspera[remoteJid];

                        console.log(`📦 Ventana cerrada. Procesando paquete de ${cantidadDocs} documentos.`);

                        const listaDetalladaDocs = paqueteDocs
                            .map((doc, index) =>
                                `• <b>Archivo ${index + 1}:</b> [${doc.tipo}] - <i>"${doc.texto}"</i>`
                            ).join('\n');

                        const alertaExpediente = `
📂 <b>EXPEDIENTE DE DOCUMENTOS RECIBIDO</b> 📂
--------------------------------------------------
👤 <b>Lead ID:</b> ${leadId}
📱 <b>Teléfono:</b> +${telefono}
📊 <b>Archivos indexados:</b> ${cantidadDocs}

📋 <b>Material recopilado:</b>
${listaDetalladaDocs}

⚖️ <b>Siguiente acción:</b> Archivos en <code>downloads/</code>. El equipo jurídico puede iniciar revisión.
--------------------------------------------------`;

                        enviarAlertaTelegram(alertaExpediente).catch(err =>
                            console.error('⚠️ Falló envío a Telegram (expediente):', err)
                        );

                        const respuestaRecibido = cantidadDocs > 1
                            ? `¡Recibidos perfectamente! Acabo de indexar estos ${cantidadDocs} documentos en tu expediente digital. Si tienes más papeles pendientes (como el croquis o la historia clínica), síguelos enviando por aquí. Una vez tengamos todo completo, nuestro equipo legal iniciará la validación a fondo.`
                            : `¡Recibido perfectamente! Acabo de indexar este documento en tu expediente digital. Si tienes más papeles pendientes (como el croquis o la historia clínica), síguelos enviando por aquí. Una vez tengamos todo completo, nuestro equipo legal iniciará la validación a fondo.`;

                        await enviarConEfectoHumano(sock, remoteJid, respuestaRecibido);
                        await pool.query(
                            'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                            [leadId, respuestaRecibido]
                        );

                    } catch (timeoutError) {
                        console.error('❌ Error procesando cola de archivos agrupados:', timeoutError);
                    }
                }, 5000);

            // ── Texto en fase documentación: agente Q&A ───────────────────────
            } else if (tipoMensaje === 'text') {

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

                await enviarConEfectoHumano(sock, remoteJid, resultadoDoc.respuesta);
                await pool.query(
                    'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                    [leadId, resultadoDoc.respuesta]
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