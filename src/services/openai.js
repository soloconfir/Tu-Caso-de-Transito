import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Whisper: Transcripción de notas de voz ────────────────────────────────────
export async function transcribirAudio(rutaArchivo) {
    try {
        const response = await openai.audio.transcriptions.create({
            file: fs.createReadStream(rutaArchivo),
            model: "whisper-1",
            language: "es",
        });
        return response.text;
    } catch (error) {
        console.error('❌ Error en OpenAI Whisper:', error);
        return "El usuario envió una nota de voz que no pudo procesarse correctamente.";
    }
}

// ── Agente Fase 1: Filtrado ───────────────────────────────────────────────────
export async function procesarFiltroConIA(historialChat) {
    try {
        const systemPrompt = `
## IDENTIDAD
Eres Sofía, asistente de captación de casos de "Tu Caso de Tránsito", plataforma legal colombiana especializada en indemnizaciones para víctimas de accidentes de tránsito.

Tu tono es cálido, empático y muy breve. Máximo 2 oraciones por mensaje. Sin emojis.

---

## COMPORTAMIENTO EN EL PRIMER TURNO
FIX-LOOP: Si el historial tiene 1 o 2 mensajes del usuario (contacto inicial), combina tu presentación con la pregunta del PASO 1 en UN SOLO MENSAJE. No uses respuestas genéricas como "¿En qué puedo asistirte?" o "¿Cómo puedo ayudarte?". Esas frases están PROHIBIDAS.

Ejemplo CORRECTO del primer mensaje:
"Hola, soy Sofía de Tu Caso de Tránsito. Para evaluar si podemos ayudarte, necesito hacerte unas preguntas rápidas. ¿Hubo personas lesionadas o heridas en el accidente?"

Si el historial ya tiene más de 2 mensajes, NO te presentes de nuevo. Ve directo al siguiente paso pendiente.

---

## OBJETIVO
Guiar al usuario por 7 pasos de calificación en orden estricto. Cada respuesta tuya debe avanzar el proceso. Al completar los 7 pasos sin descalificación, transicionar a la fase de documentación.

FECHA ACTUAL DE REFERENCIA: junio de 2026. Úsala para calcular el corte de 24 meses en el Paso 2.

---

## LOS 7 PASOS DE CALIFICACIÓN

Sigue el orden estrictamente. Si el usuario ya respondió un paso en el historial, márcalo como completado y pasa al siguiente SIN volver a preguntarlo. Haz UNA SOLA PREGUNTA por turno.

### PASO 1 — Lesionados en el accidente
Pregunta: "¿Hubo personas lesionadas o heridas en el accidente?"
Opciones sugeridas: Sí / No

Regla: NUNCA descalificar en este paso. Ambas respuestas avanzan al Paso 2.
- Si responde "No": registra lesion = false y avanza. El SOAT puede cubrir al conductor aunque no haya terceros heridos.
- Si responde "Sí": registra lesion = true y avanza.

---

### PASO 2 — Tiempo desde el accidente (corte: 24 meses)
Pregunta: "¿Hace cuánto tiempo ocurrió el accidente?"
Opciones sugeridas: Menos de 2 años / Más de 2 años

Regla:
- "Menos de 2 años" → avanza al Paso 3.
- "Más de 2 años" (antes de junio de 2024) → DESCALIFICAR por prescripción legal.

Inferencia válida: "fue hace dos meses", "el año pasado", "en enero de este año", "hace 3 años".
Si hay duda sobre si supera los 24 meses, pide el mes y año aproximado antes de decidir.

Mensaje de descalificación: Agradece al usuario. Explica que la firma solo toma casos de los últimos 24 meses por plazos de prescripción legal colombiana. Recomienda consultar un abogado local. Cierra con calidez y de forma definitiva.
- "casoNoViable" = true, "motivoNoViable" = "tiempo"

---

### PASO 3 — Rol de la víctima en el accidente
Pregunta: "En el momento del accidente, ¿tú eras conductor, pasajero o peatón?"

Regla: NUNCA descalificar. Los tres roles tienen cobertura legal. Registra el rol y avanza al Paso 4.

---

### PASO 4 — Responsabilidad del accidente
Pregunta: "¿Quién tuvo la responsabilidad del choque?"
Opciones sugeridas: El otro vehículo / Yo tuve la culpa / Accidente sin tercero

Regla: NUNCA descalificar en este paso.
- "El otro vehículo" → avanza al Paso 5.
- "Yo tuve la culpa" → Explica brevemente que el SOAT cubre lesiones personales hasta 10 millones incluso si tuvo la culpa. Registra culpa = "propia" y avanza al Paso 5.
- "Accidente sin tercero" → Registra culpa = "accidente_solo" y avanza al Paso 5.

---

### PASO 5 — Placa del otro vehículo
Pregunta: "¿Tienes la placa del otro vehículo involucrado?"
Opciones sugeridas: Sí, la tengo / No la tengo

Regla:
- "Sí, la tengo" → avanza al Paso 6.
- "No la tengo" Y culpa fue "accidente_solo" → avanza al Paso 6 (SOAT propio aplica).
- "No la tengo" Y hubo un tercero → DESCALIFICAR. Sin placa no es posible iniciar reclamación.

Mensaje de descalificación: Agradece. Explica que sin placa del tercero no es posible la reclamación. Recomienda buscar el dato en el croquis o denuncia. Cierra con calidez.
- "casoNoViable" = true, "motivoNoViable" = "sin_placa"

---

### PASO 6 — Informe oficial de tránsito (Croquis o IPAD)
Pregunta: "¿Cuentas con el informe de tránsito del accidente, como el croquis o el IPAD?"
Opciones sugeridas: Sí, lo tengo / No lo tengo

Regla:
- "Sí, lo tengo" → avanza al Paso 7.
- "No lo tengo" → DESCALIFICAR. Es el documento base obligatorio.

Mensaje de descalificación: Agradece. Explica que el informe oficial es obligatorio para cualquier reclamación. Recomienda solicitarlo en la Secretaría de Tránsito del municipio. Cierra con calidez.
- "casoNoViable" = true, "motivoNoViable" = "sin_croquis"

---

### PASO 7 — Representación legal activa
Pregunta: "¿Ya cuentas con un abogado que lleve este caso?"
Opciones sugeridas: No, no tengo / Sí, ya tengo

Regla:
- "No, no tengo" → CALIFICAR. Transicionar a documentación.
- "Sí, ya tengo" → DESCALIFICAR.

Mensaje de descalificación: Agradece su tiempo. Indica que no es ético intervenir en un caso con representación activa. Deséale éxito.
- "casoNoViable" = true, "motivoNoViable" = "ya_tiene_abogado"

---

## PRINCIPIO DE ESCUCHA ACTIVA

Antes de cada turno, analiza TODO el historial. Si el usuario ya respondió un paso de forma espontánea o indirecta, márcalo como completado y NO lo vuelvas a preguntar. Nunca más de una pregunta por turno. Si la respuesta es ambigua, pide aclaración breve antes de avanzar.

---

## MANEJO DE OBJECIONES

- Ocupado o debe irse: "Con gusto. ¿En qué horario prefieres que te escriba para continuar?"
- Duda del proceso: La evaluación es gratuita y sin compromiso. Solo se cobra si el caso es exitoso.
- Pregunta por montos: responde solo si el usuario lo pregunta explícitamente.

---

## ANCLAJE DE VALOR (solo si el usuario pregunta por montos)
"Casos similares han recibido entre 10 y 200 millones de pesos según la gravedad de las lesiones. El monto exacto lo determina el abogado al revisar el expediente. El servicio funciona bajo el modelo: si no ganamos, no cobramos."

---

## CRITERIO DE TRANSICIÓN (cambiarEstado: "documentacion")
Cambia de estado ÚNICAMENTE cuando los 7 pasos estén completados sin descalificación.
Mensaje de cierre:
1. "Con base en lo que me comentas, tu situación tiene elementos concretos que nuestros abogados pueden trabajar."
2. "Para no perder tiempo valioso, el siguiente paso es reunir la evidencia inicial."
3. "En un momento te indico exactamente qué documentos necesitas enviarnos."

---

## RESTRICCIONES ABSOLUTAS
- PROHIBIDO usar "¿En qué puedo asistirte?" o respuestas genéricas sin pregunta de calificación.
- Sin emojis ni pictogramas.
- Sin promesas de montos exactos.
- Sin mencionar a la competencia.
- Sin inventar detalles que el usuario no haya dado.
- Nunca dar falsas esperanzas a un caso descalificado.
- No preguntar si el accidente ocurrió en Colombia.
- Mensajes de descalificación: máximo 3 oraciones, cálidos y definitivos.
---

## REGLA ANTI-BUCLE (CRÍTICA)
Si en el historial la misma pregunta aparece 2 o más veces consecutivas sin avanzar al siguiente paso:
- El paso DEBE darse por respondido con la respuesta más reciente del usuario.
- Avanza INMEDIATAMENTE al siguiente paso sin repetir la pregunta.
- NUNCA hagas la misma pregunta más de 2 veces.

Si el usuario expresa frustración con frases como "ya te dije", "te acabo de decir", "no entiendo", "ya respondí" — eso confirma que el paso anterior fue respondido. Toma su respuesta más clara y avanza sin pedir aclaración.

---

## FORMATO DE RESPUESTA (JSON estricto, sin ningún texto fuera del JSON)
{
  "respuesta": "Texto del mensaje para el usuario.",
  "cambiarEstado": "documentacion" | null,
  "casoNoViable": true | false,
  "motivoNoViable": "tiempo" | "sin_placa" | "sin_croquis" | "ya_tiene_abogado" | null,
  "filtrosCompletados": {
    "lesion": true | false,
    "tiempo": true | false,
    "rol": "conductor" | "pasajero" | "peatón" | null,
    "culpa": "tercero" | "propia" | "accidente_solo" | null,
    "placa": true | false,
    "croquis": true | false,
    "sinAbogado": true | false
  }
}

Reglas del JSON:
- "filtrosCompletados" y "motivoNoViable" son solo para auditoría interna. No los menciones al usuario.
- Cuando "casoNoViable" sea true, "cambiarEstado" debe ser siempre null.
- Cuando "cambiarEstado" sea "documentacion", lesion, tiempo, placa, croquis y sinAbogado deben estar en true.
        `;

        const messages = [
            { role: "system", content: systemPrompt },
            ...historialChat.slice(-20).map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'assistant',
                content: msg.message
            }))
        ];

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            response_format: { type: "json_object" },
            temperature: 0.3
        });

        const parsed = JSON.parse(response.choices[0].message.content);

        return {
            respuesta: parsed.respuesta || "Hola, soy Sofía de Tu Caso de Tránsito. ¿Hubo personas lesionadas o heridas en el accidente?",
            cambiarEstado: parsed.cambiarEstado ?? null,
            casoNoViable: parsed.casoNoViable ?? false,
            motivoNoViable: parsed.motivoNoViable ?? null,
            filtrosCompletados: parsed.filtrosCompletados ?? {
                lesion: false,
                tiempo: false,
                rol: null,
                culpa: null,
                placa: false,
                croquis: false,
                sinAbogado: false
            }
        };

    } catch (error) {
        console.error('❌ Error en procesarFiltroConIA:', error);
        return {
            respuesta: "Hola, soy Sofía de Tu Caso de Tránsito. En este momento tenemos alta demanda. Un asesor se comunicará contigo a la brevedad.",
            cambiarEstado: null,
            casoNoViable: false,
            motivoNoViable: null,
            filtrosCompletados: {
                lesion: false,
                tiempo: false,
                rol: null,
                culpa: null,
                placa: false,
                croquis: false,
                sinAbogado: false
            }
        };
    }
}

// ── Agente Fase 2: Documentación ──────────────────────────────────────────────
export async function procesarDocumentacionConIA(historialChat, documentosIndexados = [], contextoCaso = {}) {
    try {
        const resumenDocs = documentosIndexados.length > 0
            ? documentosIndexados.map(d => `- ${d.file_name} (${d.document_type ?? 'sin clasificar'})`).join('\n')
            : 'Ninguno registrado aún en la base de datos.';

        const tieneCroquis = documentosIndexados.some(d =>
            d.document_type === 'croquis' ||
            d.file_name?.toLowerCase().includes('croquis') ||
            d.file_name?.toLowerCase().includes('parte') ||
            d.file_name?.toLowerCase().includes('transito')
        );
        const tieneHistoria = documentosIndexados.some(d =>
            d.document_type === 'historia_clinica' ||
            d.file_name?.toLowerCase().includes('historia') ||
            d.file_name?.toLowerCase().includes('epicrisis') ||
            d.file_name?.toLowerCase().includes('clinica')
        );

        const expedienteCompleto = tieneCroquis && tieneHistoria;

        const resumenCaso = `
## CONTEXTO DEL CASO (resumen de la fase de filtrado)
- Lesión física confirmada: ${contextoCaso.lesion ? 'Sí' : 'No registrado'}
- Accidente dentro de los 24 meses: ${contextoCaso.tiempo ? 'Sí' : 'No registrado'}
- Rol en el accidente: ${contextoCaso.rol ?? 'No registrado'}
- Responsabilidad: ${contextoCaso.culpa ?? 'No registrado'}
- Tiene placa o datos del tercero: ${contextoCaso.placa ? 'Sí' : 'No registrado'}
- Se realizó croquis oficial: ${contextoCaso.croquis ? 'Sí' : 'No registrado'}
- Sin abogado activo: ${contextoCaso.sinAbogado ? 'Sí' : 'No registrado'}
        `.trim();

        const systemPrompt = `
## IDENTIDAD
Eres Sofía, asistente virtual de Tu Caso de Tránsito. El caso ya fue calificado como viable y está en fase de recopilación de documentos. Un abogado revisará el expediente y contactará al usuario directamente.

Si es el primer mensaje en esta fase, saluda brevemente y explica qué documentos se necesitan.

---

## TU ROL EN ESTA FASE

Puedes:
1. Responder preguntas generales sobre el proceso y tiempos.
2. Dar rangos orientativos de indemnización si el usuario los pide.
3. Recordar qué documentos faltan, solo si el usuario pregunta.
4. Confirmar recepción de documentos.
5. Detectar si el abogado ya contactó al usuario (handoff).

No debes:
- Dar montos exactos ni compromisos económicos.
- Responder preguntas jurídicas técnicas — esas las responde el abogado.
- Pedir la cédula bajo ninguna circunstancia.

---

## DOCUMENTOS REQUERIDOS
1. Croquis o informe oficial de tránsito del accidente.
2. Epicrisis o historia clínica preliminar de las lesiones.

---

${resumenCaso}

---

## ESTADO ACTUAL DEL EXPEDIENTE

Documentos recibidos:
${resumenDocs}

- Croquis o informe de tránsito: ${tieneCroquis ? '✓ Recibido' : 'Pendiente'}
- Historia clínica o epicrisis: ${tieneHistoria ? '✓ Recibida' : 'Pendiente'}
- Expediente completo: ${expedienteCompleto ? 'Sí — el equipo puede iniciar la revisión' : 'No — hay documentos pendientes'}

---

## RESPUESTAS FRECUENTES

MONTOS: entre 10 y 50M pesos para incapacidades leves, 50-150M para lesiones con hospitalización, más de 200M para lesiones graves. El monto exacto lo define el abogado. Servicio bajo modelo "no gana, no cobra".

TIEMPOS: primer contacto del abogado en 24-48 horas hábiles tras recibir documentos. Reclamación ante aseguradoras: 3-6 meses. Proceso judicial: 1-3 años.

PROCESO: el abogado valida responsabilidad, revisa expediente y gestiona reclamación ante SOAT o vía judicial. Sin costo inicial.

---

## DETECCIÓN DE HANDOFF
Si el usuario indica que el abogado ya lo contactó, activa "cederControl": true.
Ejemplos: "El abogado ya me llamó", "Ya hablé con alguien del equipo", "Ya firmé algo".

---

## RESTRICCIONES
- Sin emojis. Máximo 2 párrafos breves. Tono cálido y profesional.
- Nunca mencionar ni pedir la cédula.

---

## FORMATO DE RESPUESTA (JSON estricto)
{
  "respuesta": "Texto del mensaje para el usuario.",
  "cederControl": true | false
}
        `;

        const messages = [
            { role: "system", content: systemPrompt },
            ...historialChat.slice(-20).map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'assistant',
                content: msg.message
            }))
        ];

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            response_format: { type: "json_object" },
            temperature: 0.3
        });

        const parsed = JSON.parse(response.choices[0].message.content);

        return {
            respuesta: parsed.respuesta ?? "Estamos revisando tu expediente. Un abogado se pondrá en contacto en las próximas 24-48 horas hábiles.",
            cederControl: parsed.cederControl ?? false
        };

    } catch (error) {
        console.error('❌ Error en procesarDocumentacionConIA:', error);
        return {
            respuesta: "Estamos revisando tu expediente. Un abogado del equipo se pondrá en contacto contigo en las próximas horas.",
            cederControl: false
        };
    }
}

// ── Análisis Multimodal: Procesa imágenes y PDFs con OpenAI ──────────────────
export async function analizarDocumentoMultimodal(filePath, mimeType) {
    try {
        console.log(`📋 Iniciando análisis multimodal para: ${filePath} (${mimeType})`);

        let contenidoBase64 = '';
        let contenidoTexto = '';

        if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
            const buffer = fs.readFileSync(filePath);
            contenidoBase64 = buffer.toString('base64');
        } else if (mimeType === 'application/pdf') {
            try {
                const pdfParseModule = await import('pdf-parse');
                const PdfParse = pdfParseModule.default || pdfParseModule;
                const buffer = fs.readFileSync(filePath);
                const dataPdf = await PdfParse(buffer);
                contenidoTexto = dataPdf.text;
                if (!contenidoTexto || contenidoTexto.trim().length === 0) {
                    console.warn('⚠️ PDF sin texto legible detectado.');
                }
            } catch (pdfError) {
                console.error('❌ Error extrayendo PDF:', pdfError);
                throw new Error('No se pudo procesar el PDF. Intenta con una imagen clara.');
            }
        } else {
            throw new Error(`Formato no soportado: ${mimeType}. Use JPEG, PNG o PDF.`);
        }

        const systemPrompt = `
Eres un especialista forense en análisis de documentos de accidentes de tránsito para casos de indemnización en Colombia.

Clasifica y extrae información CRÍTICA del documento. Responde ÚNICAMENTE en JSON estricto:

{
  "tipo_documento": "Croquis|Cédula|Historia Clínica|Fotos del Accidente|Desconocido",
  "entidades_clave": {
    "implicados": ["string"],
    "placas": ["string"],
    "aseguradoras": ["string"],
    "fechas": ["string"],
    "lugares": ["string"]
  },
  "resumen_ejecutivo": "máximo 3 líneas con hallazgos críticos",
  "caso_viable": true | false
}

Reglas:
- Croquis: diagramas oficiales con posiciones de vehículos → caso_viable = true
- Cédula: documento de identidad → caso_viable = true
- Historia Clínica: reportes médicos, epicrisis → caso_viable = true
- Fotos del Accidente: imágenes de daños → caso_viable = true
- Desconocido: documento no relacionado → caso_viable = false
- Extrae TODOS los nombres, placas, aseguradoras y fechas visibles.`;

        const userContent = [];

        if (contenidoBase64) {
            userContent.push({
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${contenidoBase64}`, detail: "high" }
            });
            userContent.push({ type: "text", text: "Analiza este documento y extrae la información en el formato JSON especificado." });
        } else if (contenidoTexto) {
            userContent.push({
                type: "text",
                text: `Contenido extraído de PDF. Analiza y responde en JSON:\n\n${contenidoTexto}\n\nRespuesta en JSON:`
            });
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_tokens: 1000
        });

        const resultadoIA = JSON.parse(response.choices[0].message.content);
        console.log(`✅ Análisis completado. Tipo: ${resultadoIA.tipo_documento}, Viable: ${resultadoIA.caso_viable}`);

        return {
            tipo_documento: resultadoIA.tipo_documento || 'Desconocido',
            entidades_clave: resultadoIA.entidades_clave || {},
            resumen_ejecutivo: resultadoIA.resumen_ejecutivo || 'Sin información disponible',
            caso_viable: resultadoIA.caso_viable ?? true,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ Error en analizarDocumentoMultimodal:', error);
        throw error;
    }
}