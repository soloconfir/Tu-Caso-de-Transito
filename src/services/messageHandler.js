import { pool } from '../database/connection.js';
import { procesarFiltroConIA, transcribirAudio } from './openai.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { enviarAlertaTelegram } from './telegram.js';
import fs from 'fs';
import path from 'path';

const DOWNLOADS_DIR = path.join(process.cwd(), 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// ⏳ Acumuladores globales en memoria para la ventana de espera (Debounce)
const ventanasEspera = {};
const documentosAcumulados = {};

/**
 * 🤖 FUNCIÓN AUXILIAR: Simula el comportamiento de escritura humana en WhatsApp
 * Envía el estado "Escribiendo..." y genera un delay proporcional a la longitud del texto.
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
        const telefono = remoteJid.replace('@s.whatsapp.net', '');

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

        // Buscar o registrar al Lead en la Base de Datos
        let [leads] = await pool.query('SELECT id, status FROM leads WHERE phone = ?', [telefono]);
        let leadId;
        let estadoActual;

        if (leads.length === 0) {
            const [resultado] = await pool.query('INSERT INTO leads (phone, status) VALUES (?, "filtrado")', [telefono]);
            leadId = resultado.insertId;
            estadoActual = 'filtrado';
            console.log(`✨ Nuevo lead indexado en MySQL. ID: ${leadId}`);
        } else {
            leadId = leads[0].id;
            estadoActual = leads[0].status;
        }

        // Procesar descarga física si es un archivo o audio
        let rutaArchivoLocal = null;
        if (mediaMessage) {
            console.log(`⏳ Descargando archivo multimedia [${tipoMensaje}] para Lead ID ${leadId}...`);
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                const nombreArchivo = `lead_${leadId}_${Date.now()}${extensionElegida}`;
                rutaArchivoLocal = path.join(DOWNLOADS_DIR, nombreArchivo);
                fs.writeFileSync(rutaArchivoLocal, buffer);
                console.log(`💾 Archivo [${tipoMensaje}] guardado localmente en: downloads/${nombreArchivo}`);
                
                if (tipoMensaje === 'audio') {
                    console.log(`🎙️ Transcribiendo nota de voz del Lead ID ${leadId} con OpenAI Whisper...`);
                    const transcripcion = await transcribirAudio(rutaArchivoLocal);
                    console.log(`📝 Transcripción exitosa -> ${transcripcion}`);
                    textoUsuario = transcripcion; 
                }

            } catch (downloadError) {
                console.error('❌ Error al procesar el archivo multimedia:', downloadError);
                await enviarConEfectoHumano(sock, remoteJid, "Disculpa, tuve un problema técnico al escuchar tu nota de voz o procesar tu archivo. ¿Podrías repetírmelo?");
                return;
            }
        }

        // Guardar la interacción en el Historial de Chats
        await pool.query(
            'INSERT INTO chat_history (lead_id, sender, message_type, message, file_path) VALUES (?, "user", ?, ?, ?)',
            [leadId, tipoMensaje, textoUsuario, rutaArchivoLocal]
        );

        console.log(`\n📩 Mensaje final procesado de [${telefono}]: ${textoUsuario}`);

        // ==========================================
        // MÁQUINA DE ESTADOS DEL AGENTE CONVERSACIONAL
        // ==========================================

        if (estadoActual === 'filtrado') {
            if (tipoMensaje !== 'text' && tipoMensaje !== 'audio') {
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

            console.log(`🧠 Consultando a Sofía (IA) para el Lead ID: ${leadId}...`);
            const resultadoIA = await procesarFiltroConIA(historialFilas);

            // ✍️ Envío humanizado de la respuesta de la IA
            await enviarConEfectoHumano(sock, remoteJid, resultadoIA.respuesta);

            await pool.query(
                'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                [leadId, resultadoIA.respuesta]
            );

            // 🚀 Transición de estado: El lead cumple los requisitos de Sofía
            if (resultadoIA.cambiarEstado === 'documentacion') {
                await pool.query('UPDATE leads SET status = "documentacion" WHERE id = ?', [leadId]);
                console.log(`🚀 ¡Lead ID ${leadId} CALIFICADO por Sofía! Cambiado a: "documentacion".`);
                
                // 🔥 RECOMPILACIÓN COMPLETA DEL CASO DE USUARIO:
                // Filtramos solo lo expresado por el cliente en el chat para armar el relato continuo
                const testimonioCompleto = historialFilas
                    .filter(fila => fila.sender === 'user')
                    .map(fila => `• <i>${fila.message}</i>`)
                    .join('\n\n');

                // 🔥 NOTIFICACIÓN TELEGRAM POTENCIADA: Detalle extendido de lo manifestado por el usuario
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

🎯 <b>Estado del Bot:</b> Se le solicitó exitosamente Cédula, Croquis e Historia Clínica. Esperando el cargue en el canal de WhatsApp.
--------------------------------------------------`;
                
                enviarAlertaTelegram(alertaLeadCalificado).catch(err => console.error('⚠️ Falló envío a Telegram:', err));

                const mensajeTransicion = "Perfecto. Para proceder a evaluar formalmente la viabilidad jurídica de tu reclamación y radicarla ante la aseguradora o tránsito, por favor envíame por este medio fotos claras o archivos PDF de los siguientes documentos:\n\n1. Cédula del afectado.\n2. Croquis o informe de tránsito del accidente.\n3. Epicrisis o Historia clínica preliminar de las lesiones.";
                
                await enviarConEfectoHumano(sock, remoteJid, mensajeTransicion);
                await pool.query(
                    'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                    [leadId, mensajeTransicion]
                );
            }

        } else if (estadoActual === 'documentacion') {
            if (tipoMensaje === 'image' || tipoMensaje === 'document') {
                console.log(`📄 Archivo recibido en fase documental para el Lead ID ${leadId}. Agrupando en ventana de espera...`);
                
                if (!documentosAcumulados[remoteJid]) {
                    documentosAcumulados[remoteJid] = [];
                }
                
                documentosAcumulados[remoteJid].push({ tipo: tipoMensaje, texto: textoUsuario });

                if (ventanasEspera[remoteJid]) {
                    clearTimeout(ventanasEspera[remoteJid]);
                }

                ventanasEspera[remoteJid] = setTimeout(async () => {
                    try {
                        const paqueteDocs = documentosAcumulados[remoteJid] || [];
                        const cantidadDocs = paqueteDocs.length;

                        delete documentosAcumulados[remoteJid];
                        delete ventanasEspera[remoteJid];

                        console.log(`📦 Ventana de espera cerrada de forma segura. Procesando paquete de ${cantidadDocs} documentos.`);

                        // Construcción del reporte de documentos recopilados
                        const listaDetalladaDocs = paqueteDocs.map((doc, index) => `• <b>Archivo ${index + 1}:</b> Formato [${doc.tipo}] - <i>"${doc.texto}"</i>`).join('\n');
                        
                        const alertaExpediente = `
📂 <b>EXPEDIENTE DE DOCUMENTOS RECIBIDO</b> 📂
--------------------------------------------------
👤 <b>Lead ID:</b> ${leadId}
📱 <b>Teléfono:</b> +${telefono}
📊 <b>Cantidad de archivos indexados:</b> ${cantidadDocs}

📋 <b>Detalle del material recopilado:</b>
${listaDetalladaDocs}

⚖️ <b>Siguiente acción:</b> Todo el paquete físico ha sido almacenado de manera segura en la carpeta del servidor local <code>downloads/</code>. El equipo jurídico puede iniciar su revisión técnica.
--------------------------------------------------`;

                        enviarAlertaTelegram(alertaExpediente).catch(err => console.error('⚠️ Falló envío a Telegram:', err));

                        const respuestaRecibido = cantidadDocs > 1
                            ? `¡Recibidos perfectamente! Acabo de indexar estos ${cantidadDocs} documentos en tu expediente digital. Si tienes más papeles pendientes (como el croquis o la historia clínica), síguelos enviando por aquí. Una vez tengamos todo completo, nuestro equipo legal iniciará la validación a fondo.`
                            : `¡Recibido perfectamente! Acabo de indexar este documento en tu expediente digital. Si tienes más papeles pendientes (como el croquis o la historia clínica), síguelos enviando por aquí. Una vez tengamos todo completo, nuestro equipo legal iniciará la validación a fondo.`;
                        
                        await enviarConEfectoHumano(sock, remoteJid, respuestaRecibido);
                        
                        await pool.query(
                            'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                            [leadId, respuestaRecibido]
                        );

                    } catch (timeoutError) {
                        console.error('❌ Error crítico procesando la cola de archivos agrupados:', timeoutError);
                    }
                }, 5000);

            } else {
                const respuestaEsperaText = "Entendido. Sigo muy atenta a que me compartas las fotos o PDFs de los documentos solicitados (cédula, croquis o historia clínica preliminar) para que los abogados inicien la revisión de tu indemnización.";
                
                await enviarConEfectoHumano(sock, remoteJid, respuestaEsperaText);
                await pool.query(
                    'INSERT INTO chat_history (lead_id, sender, message_type, message) VALUES (?, "bot", "text", ?)',
                    [leadId, respuestaEsperaText]
                );
            }
            
        } else {
            console.log(`🔕 Lead ID ${leadId} está en estado '${estadoActual}'. Flujo ignorado de forma segura.`);
        }

    } catch (error) {
        console.error('❌ Error crítico en el flujo de ejecución del mensaje:', error);
    }
}