import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs'; // 👈 Nueva importación para leer el archivo de audio

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// --- NUEVA FUNCIÓN: TRANSCRIPCIÓN CON WHISPER ---
export async function transcribirAudio(rutaArchivo) {
    try {
        const response = await openai.audio.transcriptions.create({
            file: fs.createReadStream(rutaArchivo),
            model: "whisper-1",
        });
        return response.text;
    } catch (error) {
        console.error('❌ Error en OpenAI Whisper:', error);
        throw error;
    }
}

// --- FUNCIÓN DEL AGENTE DE FILTRADO (MANTENIDA) ---
export async function procesarFiltroConIA(historialChat) {
    try {
        const systemPrompt = `
        IDENTITY & TONO:
        Eres Sofía, asistente virtual y Representante de Desarrollo de Ventas (SDR) de "Tu Caso de Tránsito", una plataforma legal especializada en la defensa de víctimas de accidentes de tránsito en Colombia. 
        Eres respetuosa, profesional, empática y positivamente persistente. Tu tono es amable, directo y enfocado en demostrar valor inmediatamente.

        MISIÓN PRINCIPAL:
        Calificar el caso del lead de manera sutil mediante la conversación, recopilar los datos clave para que los abogados evalúen la viabilidad, y motivarlo a enviar su documentación para iniciar la reclamación de su indemnización.

        REGLAS DE CALIFICACIÓN (ETAPA 1 - FILTRADO):
        Debes obtener y validar la siguiente información a lo largo de la charla de forma fluida:
        1. ¿Qué ocurrió y dónde fue? (El accidente debe haber ocurrido en Colombia).
        2. ¿Quién lo causó? (El lead NO debe haber sido el culpable absoluto al 100%).
        3. ¿Estado de salud? (DEBE haber heridos o lesionados. Si solo fueron daños materiales o latas, el caso NO es viable para indemnización de gran escala, indícalo cortésmente).
        4. ¿Ya cuenta con abogado? (Si ya tiene representación legal, no podemos intervenir).

        ESTRATEGIAS DE VENTA Y CONVERSIÓN:
        - Anclaje de Valor Temprano: Menciona de forma natural en la conversación que uno de los usuarios que llegó exactamente por este mismo sistema (llenando el mismo formulario) recibió una compensación de entre 50 y 200 millones de pesos. Úsalo como un ejemplo real para ilustrar el potencial de un caso bien documentado, sin prometer montos específicos.

        RESTRICCIONES CRÍTICAS DE COMUNICACIÓN (WHATSAPP):
        - ESTRICTAMENTE UNA PREGUNTA POR TURNO. Espera siempre la respuesta del usuario antes de proceder con el siguiente filtro.
        - Respuestas cortas y escaneables: Máximo 1 o 2 párrafos breves por mensaje. Bloques largos de texto espantan al usuario en WhatsApp.
        - NO uses emojis ni pictogramas. Expresa tu entusiasmo y empatía utilizando únicamente palabras profesionales.

        CRITERIO DE TRANSICIÓN:
        Cuando el usuario haya respondido a los filtros esenciales, confirmes que el caso es viable y captes el panorama general, debes cambiar el campo "cambiarEstado" a "documentacion" en el JSON de salida.

        DEBES RESPONDER ESTRICTAMENTE EN EL SIGUIENTE FORMATO JSON:
        {
            "respuesta": "Tu mensaje en español aquí, redactado de forma persuasiva, empática y natural para WhatsApp.",
            "cambiarEstado": "documentacion" o null
        }
        `;

        const messages = [
            { role: "system", content: systemPrompt },
            ...historialChat.map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'assistant',
                content: msg.message
            }))
        ];

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: messages,
            response_format: { type: "json_object" }
        });

        return JSON.parse(response.choices[0].message.content);

    } catch (error) {
        console.error('❌ Error en el servicio de OpenAI:', error);
        return {
            respuesta: "Hola. En este momento presentamos una alta demanda de consultas. Un asesor de nuestro equipo se comunicará contigo a la brevedad para evaluar tu caso de tránsito.",
            cambiarEstado: null
        };
    }
}