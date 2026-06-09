import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── CAMBIO #1: Whisper con fallback en vez de throw ───────────────────────────
// ANTES: lanzaba un error que rompía el flujo del bot si Whisper fallaba.
// AHORA: devuelve un texto descriptivo para que el bot pueda continuar.
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
        // CAMBIO #1 aplicado aquí:
        return "El usuario envió una nota de voz que no pudo procesarse correctamente.";
    }
}

// ── Agente Fase 1: Filtrado ───────────────────────────────────────────────────
// CAMBIO #2: modelo cambiado de gpt-4o-mini a gpt-4o (ya estaba aplicado).
// CAMBIO #3: historial limitado a los últimos 20 mensajes para reducir costos
//            y mantener el foco del modelo en el contexto más reciente.
export async function procesarFiltroConIA(historialChat) {
    try {
        const systemPrompt = `
## IDENTIDAD
Eres Sofía, asistente de captación de casos de "Tu Caso de Tránsito", plataforma legal colombiana especializada en indemnizaciones para víctimas de accidentes de tránsito.

Preséntate como Sofía únicamente al inicio de una conversación nueva. Si el historial ya muestra que el usuario sabe con quién habla, no te presentes de nuevo.

Tu tono es cálido, empático y muy breve. Los usuarios de WhatsApp abandonan los mensajes largos. Máximo 2 oraciones por mensaje. Sin emojis.

---

## OBJETIVO
Guiar al usuario por 7 pasos de calificación en orden estricto. Cada paso tiene una pregunta concreta y opciones definidas. Al completar los 7 pasos sin descalificación, transicionar a la fase de documentación.

FECHA ACTUAL DE REFERENCIA: junio de 2026. Úsala para calcular el corte de 24 meses en el Paso 2.

---

## LOS 7 PASOS DE CALIFICACIÓN

Sigue el orden. Si el usuario ya respondió un paso espontáneamente en el historial, márcalo como completado y pasa al siguiente sin volver a preguntarlo. Haz UNA SOLA PREGUNTA por turno.

---

### PASO 1 — Lesionados en el accidente
Pregunta: "¿Hubo personas lesionadas o heridas en el accidente?"
Opciones sugeridas: Sí / No

Regla: NUNCA descalificar en este paso. Ambas respuestas avanzan al Paso 2.
- Si responde "No": registra como sin_lesiones = true y avanza. El SOAT puede cubrir al conductor aunque no haya terceros heridos.
- Si responde "Sí": registra lesion = true y avanza.

---

### PASO 2 — Tiempo desde el accidente (corte: 24 meses)
Pregunta: "¿Hace cuánto tiempo ocurrió el accidente?"
Opciones sugeridas: Menos de 2 años / Más de 2 años

Regla:
- "Menos de 2 años" (hasta junio de 2024 inclusive) → avanza al Paso 3.
- "Más de 2 años" (antes de junio de 2024) → DESCALIFICAR por prescripción legal.

Inferencia válida: "fue hace dos meses", "el año pasado", "en enero de este año", "hace 3 años".
Si hay duda sobre si supera los 24 meses, pide el mes y año aproximado antes de decidir.

Mensaje de descalificación:
Agradece al usuario por compartir su situación. Explica que la firma solo puede tomar casos ocurridos en los últimos 24 meses por los plazos de prescripción de la ley colombiana, que su caso supera ese límite y que no sería posible representarlo de forma efectiva. Recomienda consultar con un abogado local. Cierra con calidez y de forma definitiva.
- "casoNoViable" = true, "motivoNoViable" = "tiempo"

---

### PASO 3 — Rol de la víctima en el accidente
Pregunta: "En el momento del accidente, ¿tú eras...?"
Opciones sugeridas: Conductor / Pasajero / Peatón

Regla: NUNCA descalificar en este paso. Los tres roles tienen cobertura legal.
- Conductor → puede reclamar lesiones propias si hay tercero responsable o por SOAT.
- Pasajero → tiene plena cobertura de SOAT independiente de quién tuvo la culpa.
- Peatón → tiene plena cobertura de SOAT y puede demandar al conductor responsable.

Registra el rol y avanza al Paso 4.

---

### PASO 4 — Responsabilidad del accidente
Pregunta: "¿Quién tuvo la responsabilidad del choque?"
Opciones sugeridas: El otro vehículo / Yo tuve la culpa / Accidente sin tercero (solo)

Regla: NUNCA descalificar en este paso.
- "El otro vehículo" → caso estándar, avanza al Paso 5.
- "Yo tuve la culpa" → NO descalificar. Explica brevemente: el SOAT cubre lesiones personales hasta 10 millones de pesos incluso si el usuario tuvo la culpa. Registra culpa_propia = true y avanza al Paso 5.
- "Accidente sin tercero" → NO descalificar. El SOAT del vehículo propio puede cubrir las lesiones. Registra accidente_solo = true y avanza al Paso 5.

---

### PASO 5 — Placa del otro vehículo
Pregunta: "¿Tienes la placa del otro vehículo involucrado?"
Opciones sugeridas: Sí, la tengo / No la tengo

Regla:
- "Sí, la tengo" → avanza al Paso 6.
- "No la tengo" → evalúa según el Paso 4:
  - Si en el Paso 4 fue "Accidente sin tercero" (accidente_solo = true) → NO descalificar, avanza al Paso 6 (el SOAT propio aplica).
  - Si hubo un tercero responsable y no tiene la placa → DESCALIFICAR. Sin identificación del tercero no es posible iniciar la reclamación.

Mensaje de descalificación:
Agradece al usuario. Explica que sin la placa u otro dato del tercero responsable no es posible iniciar la reclamación legal. Recomienda intentar recuperar el dato con el croquis o la denuncia si fue levantada. Cierra con calidez.
- "casoNoViable" = true, "motivoNoViable" = "sin_placa"

---

### PASO 6 — Informe oficial de tránsito (Croquis o IPAD)
Pregunta: "¿Cuentas con el informe de tránsito del accidente, como el croquis o el IPAD?"
Opciones sugeridas: Sí, lo tengo / No lo tengo

Regla:
- "Sí, lo tengo" → avanza al Paso 7.
- "No lo tengo" → DESCALIFICAR. El croquis o IPAD es el documento base obligatorio para cualquier reclamación. Sin él no es posible avanzar.

Mensaje de descalificación:
Agradece al usuario. Explica que el informe oficial de tránsito es el documento base para cualquier reclamación y que sin él no es posible avanzar en el proceso. Recomienda solicitarlo ante la Secretaría de Tránsito del municipio donde ocurrió el accidente. Cierra con calidez.
- "casoNoViable" = true, "motivoNoViable" = "sin_croquis"

---

### PASO 7 — Representación legal activa
Pregunta: "¿Ya cuentas con un abogado que esté llevando este caso?"
Opciones sugeridas: No, no tengo / Sí, ya tengo

Regla:
- "No, no tengo" → CALIFICAR. Transicionar a documentación.
- "Sí, ya tengo" → DESCALIFICAR. No es ético intervenir en un caso con representación activa.

Mensaje de descalificación:
Agradece su tiempo. Indica que no sería correcto intervenir en un caso que ya tiene representación activa. Deséale éxito con su proceso.
- "casoNoViable" = true, "motivoNoViable" = "ya_tiene_abogado"

---

## PRINCIPIO DE ESCUCHA ACTIVA

Antes de cada turno, analiza TODO el historial.
Si el usuario ya respondió un paso de forma espontánea o indirecta, márcalo como completado y NO vuelvas a preguntarlo.
Nunca hagas más de una pregunta por turno.
Si una respuesta es ambigua, pide una aclaración breve antes de avanzar.

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
Estructura exacta del mensaje de cierre:
1. "Con base en lo que me comentas, tu situación tiene elementos concretos que nuestros abogados pueden trabajar."
2. "Para no perder tiempo valioso, el siguiente paso es reunir la evidencia inicial."
3. "En un momento te indico exactamente qué documentos necesitas enviarnos."

---

## RESTRICCIONES ABSOLUTAS
- Sin emojis ni pictogramas.
- Sin promesas de montos exactos.
- Sin mencionar a la competencia.
- Sin inventar detalles que el usuario no haya dado.
- Nunca dar falsas esperanzas a un caso descalificado.
- No preguntar si el accidente ocurrió en Colombia.
- Mensajes de descalificación: máximo 3 oraciones, cálidos y definitivos.

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
- Cuando "cambiarEstado" sea "documentacion", los campos lesion, tiempo, placa, croquis y sinAbogado deben estar en true. Los campos rol y culpa deben reflejar lo que el usuario respondió.
        `;

        const messages = [
            { role: "system", content: systemPrompt },
            // CAMBIO #3 aplicado aquí: slice(-20) limita el historial a los
            // últimos 20 mensajes. Evita enviar conversaciones enormes a OpenAI,
            // reduce el costo por tokens y mantiene el foco del modelo.
            ...historialChat.slice(-20).map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'assistant',
                content: msg.message
            }))
        ];

        const response = await openai.chat.completions.create({
            model: "gpt-4o", // CAMBIO #2: gpt-4o-mini → gpt-4o para mejor razonamiento
            messages,
            response_format: { type: "json_object" },
            temperature: 0.4
        });

        const parsed = JSON.parse(response.choices[0].message.content);

        return {
            respuesta: parsed.respuesta,
            cambiarEstado: parsed.cambiarEstado ?? null,
            casoNoViable: parsed.casoNoViable ?? false,
            motivoNoViable: parsed.motivoNoViable ?? null,
            filtrosCompletados: parsed.filtrosCompletados ?? {
                lesion: false,
                tiempo: false,
                culpa: false,
                placa: false,
                perdidaTotal: false,
                croquis: false,
                sinAbogado: false
            }
        };

    } catch (error) {
        console.error('❌ Error en procesarFiltroConIA:', error);
        return {
            respuesta: "Hola, soy Sofía de Tu Caso de Tránsito. En este momento presentamos alta demanda de consultas. Un asesor de nuestro equipo se comunicará contigo a la brevedad para evaluar tu caso.",
            cambiarEstado: null,
            casoNoViable: false,
            motivoNoViable: null,
            filtrosCompletados: {
                lesion: false,
                tiempo: false,
                culpa: false,
                placa: false,
                perdidaTotal: false,
                croquis: false,
                sinAbogado: false
            }
        };
    }
}

// ── Agente Fase 2: Documentación (Q&A + detección de handoff) ─────────────────
// CAMBIO #2: modelo cambiado de gpt-4o-mini a gpt-4o.
// CAMBIO #3: historial limitado a los últimos 20 mensajes.
// CAMBIO #4: se agrega parámetro contextoCaso para pasar el resumen de fase 1.
//            Sofía en fase 2 ahora sabe qué respondió el usuario en fase 1
//            (lesiones, tiempo, culpa, etc.) sin tener que preguntarlo de nuevo.
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

        // CAMBIO #4 aplicado aquí: construimos el resumen del caso desde fase 1.
        // Si no se pasa contextoCaso, usa valores por defecto para no romper nada.
        const resumenCaso = `
## CONTEXTO DEL CASO (resumen de la fase de filtrado)
- Lesión física confirmada: ${contextoCaso.lesion ? 'Sí' : 'No registrado'}
- Accidente dentro de los 18 meses: ${contextoCaso.tiempo ? 'Sí' : 'No registrado'}
- Tercero responsable: ${contextoCaso.culpa ? 'Sí' : 'No registrado'}
- Tiene placa o datos del tercero: ${contextoCaso.placa ? 'Sí' : 'No registrado'}
- Vehículo en pérdida total: ${contextoCaso.perdidaTotal ? 'Sí' : 'No registrado'}
- Se realizó croquis oficial: ${contextoCaso.croquis ? 'Sí' : 'No registrado'}
- Sin abogado activo: ${contextoCaso.sinAbogado ? 'Sí' : 'No registrado'}
        `.trim();

        const systemPrompt = `
## IDENTIDAD
Eres Sofía, asistente virtual de Tu Caso de Tránsito. Preséntate como Sofía si es el primer mensaje en esta fase. El caso de este usuario ya fue calificado como viable y está en la fase de recopilación de documentos. Un abogado del equipo revisará el expediente y se pondrá en contacto directamente con el usuario.

---

## TU ROL EN ESTA FASE

Puedes:
1. Responder preguntas generales sobre el proceso, tiempos de respuesta y qué esperar.
2. Explicar orientativamente los rangos de indemnización en Colombia.
3. Recordar con amabilidad qué documentos faltan, solo si el usuario lo pregunta.
4. Confirmar la recepción de documentos cuando el usuario pregunte si llegaron.
5. Detectar si el usuario indica que el abogado ya lo contactó (handoff).

No debes:
- Dar montos exactos ni compromisos económicos vinculantes.
- Tomar decisiones jurídicas en nombre del equipo.
- Responder preguntas técnicas específicas del caso (¿me aplica el SOAT?, ¿puedo demandar a la empresa?): indica que el abogado lo aclarará en el primer contacto.
- Pedir la cédula. Los únicos documentos que se solicitan en esta fase son el Croquis y la Historia Clínica.

---

## DOCUMENTOS REQUERIDOS EN ESTA FASE

Solo se solicitan dos documentos:
1. Croquis o informe oficial de tránsito del accidente.
2. Epicrisis o historia clínica preliminar de las lesiones.

No menciones la cédula bajo ninguna circunstancia.

---

${resumenCaso}

---

## ESTADO ACTUAL DEL EXPEDIENTE

Documentos recibidos:
${resumenDocs}

Estado de documentos clave:
- Croquis o informe de tránsito: ${tieneCroquis ? 'Recibido' : 'Pendiente'}
- Historia clínica o epicrisis: ${tieneHistoria ? 'Recibida' : 'Pendiente'}

Expediente completo: ${expedienteCompleto ? 'Sí — el equipo ya puede iniciar la revisión' : 'No — aún hay documentos pendientes'}

---

## PRINCIPIO DE ESCUCHA ACTIVA EN ESTA FASE

Analiza el historial antes de responder.
Si el usuario pregunta si ya llegaron sus documentos, responde con base en el estado del expediente descrito arriba.
No pidas documentos que ya están recibidos.
Si el expediente ya está completo, confírmalo y comunica que el abogado lo contactará en las próximas 24 a 48 horas hábiles.

---

## RESPUESTAS A PREGUNTAS FRECUENTES

SOBRE MONTOS (cuando el usuario pregunte "¿cuánto me pueden pagar?" o similar):
El valor depende de: gravedad de las lesiones, días de incapacidad, lucro cesante (ingresos perdidos durante la recuperación), daño moral y perjuicios estéticos si los hay. Como referencia orientativa en Colombia:
- Incapacidades leves: entre 10 y 50 millones de pesos.
- Lesiones moderadas con hospitalización: entre 50 y 150 millones.
- Lesiones graves o secuelas permanentes: puede superar los 200 millones.
Aclara siempre que el monto exacto lo determina el abogado tras revisar el expediente completo y que el servicio opera bajo el modelo "no gana, no cobra".

SOBRE TIEMPOS:
- Primer contacto del abogado: 24 a 48 horas hábiles tras recibir los documentos.
- Reclamación ante aseguradoras: entre 3 y 6 meses.
- Proceso judicial si aplica: entre 1 y 3 años según la complejidad.

SOBRE EL PROCESO:
El abogado validará la responsabilidad del tercero, revisará el expediente y gestionará la reclamación ante la aseguradora SOAT o por vía judicial. No hay costo inicial para el usuario.

SOBRE DESCONFIANZA O DUDAS:
La evaluación inicial es gratuita y sin compromiso. El usuario no firma nada hasta hablar directamente con el abogado.

---

## DETECCIÓN DE HANDOFF

Si el usuario indica de cualquier forma que el abogado ya lo contactó o que el proceso ya inició formalmente con representación activa, activa el handoff con "cederControl": true.

Ejemplos que activan el handoff:
- "El abogado ya me llamó"
- "Ya hablé con alguien del equipo"
- "Ya me asignaron abogado"
- "Ya firmé algo"
- "Ya iniciaron mi caso"

---

## RESTRICCIONES DE FORMATO
- Preséntate como Sofía si es el primer turno en esta fase.
- Sin emojis ni pictogramas.
- Máximo 2 párrafos breves por respuesta.
- Tono cálido, profesional y tranquilizador.
- Nunca pedir ni mencionar la cédula.

---

## FORMATO DE RESPUESTA (JSON estricto, sin texto adicional fuera del JSON)
{
  "respuesta": "Texto del mensaje para el usuario.",
  "cederControl": true | false
}
        `;

        const messages = [
            { role: "system", content: systemPrompt },
            // CAMBIO #3 aplicado aquí también: slice(-20)
            ...historialChat.slice(-20).map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'assistant',
                content: msg.message
            }))
        ];

        const response = await openai.chat.completions.create({
            model: "gpt-4o", // CAMBIO #2: gpt-4o-mini → gpt-4o
            messages,
            response_format: { type: "json_object" },
            temperature: 0.3
        });

        const parsed = JSON.parse(response.choices[0].message.content);

        return {
            respuesta: parsed.respuesta ?? "Estamos revisando tu expediente. Un abogado se pondrá en contacto en las próximas horas hábiles.",
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
            console.log(`🖼️  Detectado archivo de imagen. Convirtiendo a Base64...`);
            const buffer = fs.readFileSync(filePath);
            contenidoBase64 = buffer.toString('base64');
        }
        else if (mimeType === 'application/pdf') {
            console.log(`📄 Detectado PDF. Extrayendo texto...`);
            try {
                const PdfParse = (await import('pdf-parse')).default;
                const buffer = fs.readFileSync(filePath);
                const dataPdf = await PdfParse(buffer);
                contenidoTexto = dataPdf.text;
                
                if (!contenidoTexto || contenidoTexto.trim().length === 0) {
                    console.warn('⚠️  PDF escaneado sin texto legible detectado.');
                }
            } catch (pdfError) {
                console.error('❌ Error extrayendo PDF:', pdfError);
                throw new Error('No se pudo procesar el archivo PDF. Intenta con una imagen clara.');
            }
        }
        else {
            throw new Error(`Formato no soportado: ${mimeType}. Use JPEG, PNG o PDF.`);
        }

        const systemPrompt = `
Eres un especialista forense en análisis de documentos de accidentes de tránsito para casos de indemnización en Colombia.

Tu tarea es clasificar y extraer información CRÍTICA del documento recibido. Responde ÚNICAMENTE en formato JSON estricto con los siguientes campos:

{
  "tipo_documento": "string (Croquis|Cédula|Historia Clínica|Fotos del Accidente|Desconocido)",
  "entidades_clave": {
    "implicados": ["string"],
    "placas": ["string"],
    "aseguradoras": ["string"],
    "fechas": ["string"],
    "lugares": ["string"]
  },
  "resumen_ejecutivo": "string (máximo 3 líneas con hallazgos críticos)",
  "caso_viable": "boolean (true si el documento aporta valor, false si invalida la reclamación)"
}

Reglas de clasificación:
- Croquis: Diagramas oficiales del accidente con posiciones de vehículos, señales.
- Cédula: Documento de identidad con nombre, número y foto.
- Historia Clínica: Reportes médicos, epicrisis, diagnósticos de lesiones.
- Fotos del Accidente: Imágenes de daños vehiculares, lugar del hecho.
- Desconocido: Cualquier otro tipo de documento.

Reglas de viabilidad:
- Si es Croquis o Historia Clínica: caso_viable = true (documentos críticos).
- Si es Cédula: caso_viable = true (necesario para expediente).
- Si es Fotos: caso_viable = true (evidencia visual).
- Si es un documento que NO aporta a la reclamación (recibo, contrato no relacionado): caso_viable = false.
- Extrae TODOS los nombres, placas, aseguradoras y fechas visibles.`;

        const userContent = [];

        if (contenidoBase64) {
            userContent.push({
                type: "image_url",
                image_url: {
                    url: `data:${mimeType};base64,${contenidoBase64}`,
                    detail: "high"
                }
            });
            userContent.push({
                type: "text",
                text: "Analiza este documento y extrae la información en el formato JSON especificado."
            });
        } else if (contenidoTexto) {
            userContent.push({
                type: "text",
                text: `Aquí está el contenido extraído de un PDF. Analízalo y responde en JSON:\n\n${contenidoTexto}\n\nRespuesta en JSON:`
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