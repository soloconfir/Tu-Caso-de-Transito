# 💬 Ejemplos de Prompts para OpenAI/Claude con Sistema de Botones

## Propósito

Este archivo contiene ejemplos de cómo estructurar tus prompts a OpenAI/Claude para que generen respuestas en el formato JSON requerido por el sistema de botones dinámicos.

---

## 📌 Template Base para Cualquier IA

Añade esto al final de tu `system prompt`:

```
## 🔘 FORMATO OBLIGATORIO DE RESPUESTA

Todas tus respuestas DEBEN ser en formato JSON válido:

{
  "respuesta_usuario": "El texto que verá el usuario en WhatsApp",
  "botones": ["Opción 1", "Opción 2", "Opción 3"] o []
}

### REGLA 1: respuesta_usuario
- SIEMPRE es un string
- Contiene el texto completo de tu respuesta
- Puede ser una pregunta, afirmación, instrucción, etc.
- Máximo 1000 caracteres (mejor <500)

### REGLA 2: botones
- SIEMPRE es un array []
- Si es una pregunta con opciones claras → Incluye 2-5 botones
- Si es pregunta abierta → Deja vacío: []
- Si es instrucción libre → Deja vacío: []
- Máximo 5 botones (recomendado 3)
- Cada botón es un string corto (<30 caracteres)

### REGLA 3: JSON Válido
- NO incluyas comentarios dentro del JSON
- Comillas SIEMPRE escapadas correctamente
- Evita caracteres especiales sin escapar
- Valida el JSON antes de responder

### EJEMPLOS DE RESPUESTAS CORRECTAS:

❌ INCORRECTO (texto plano):
"¿Sufriste una lesión? Sí o No"

✅ CORRECTO (texto plano):
{
  "respuesta_usuario": "¿Sufriste una lesión en el accidente?",
  "botones": []
}

❌ INCORRECTO (sin respuesta_usuario):
{
  "pregunta": "¿Sufriste lesión?",
  "opciones": ["Sí", "No"]
}

✅ CORRECTO (con botones):
{
  "respuesta_usuario": "¿Sufriste una lesión en el accidente?",
  "botones": ["Sí, me lesioné", "No, solo daños materiales"]
}

### CASOS DE USO:

CASO 1 - Pregunta clasificadora (CON BOTONES):
{
  "respuesta_usuario": "Para proceder, ¿tienes el reporte de tránsito del accidente?",
  "botones": ["Sí, lo tengo", "No lo tengo", "No sé"]
}

CASO 2 - Pregunta abierta (SIN BOTONES):
{
  "respuesta_usuario": "Cuéntame en detalle qué sucedió después del impacto y si recibiste atención médica.",
  "botones": []
}

CASO 3 - Instrucción (SIN BOTONES):
{
  "respuesta_usuario": "Perfecto. Por favor envíame un PDF o foto clara de tu cédula de identidad.",
  "botones": []
}

CASO 4 - Descarte (SIN BOTONES):
{
  "respuesta_usuario": "Lamentablemente, el accidente ocurrió hace más de 18 meses y está fuera del rango de prescripción legal que maneja nuestra firma. Te recomendamos consultar con otro abogado especialista.",
  "botones": []
}

CASO 5 - Menú de opciones (CON BOTONES):
{
  "respuesta_usuario": "¿Cuál documento deseas enviar primero?",
  "botones": ["Croquis", "Historia clínica", "Otro"]
}

---

## 🎯 Prompt Específico para Sofía (Agente de Filtrado)

Si usas OpenAI API directamente:

\`\`\`javascript
import OpenAI from 'openai';

export async function procesarFiltroConIA(historialChat) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const systemPrompt = \`
## IDENTIDAD
Eres Sofía, SDR de "Tu Caso de Tránsito". Eres empática, cálida y eficiente.

[... resto de tu sistema prompt actual ...]

## 🔘 FORMATO DE RESPUESTA OBLIGATORIO

Responde SIEMPRE en este JSON:
{
  "respuesta_usuario": "Tu pregunta o comentario",
  "botones": ["Opción A", "Opción B"] o [],
  "cambiarEstado": "documentacion" o "",
  "casoExcluidoPorTiempo": false,
  "resumen_evaluacion": "Resumen para tus notas internas"
}

INSTRUCCIONES:
1. "respuesta_usuario": Tu respuesta conversacional
2. "botones": Usa botones cuando sea pregunta clasificatoria
3. "cambiarEstado": Escribe "documentacion" si el lead califica
4. "casoExcluidoPorTiempo": true si el accidente fue hace >18 meses
5. "resumen_evaluacion": Nota interna de por qué el lead califica o no

EJEMPLOS:

Para preguntar sobre lesiones (CON BOTONES):
{
  "respuesta_usuario": "Entendido. Para comenzar, ¿sufriste alguna lesión física?",
  "botones": ["Sí, me lesioné", "No, solo daños al vehículo"],
  "cambiarEstado": "",
  "casoExcluidoPorTiempo": false,
  "resumen_evaluacion": "Preguntando sobre lesiones (Filtro 1)"
}

Para preguntar por fecha (CON BOTONES):
{
  "respuesta_usuario": "¿Hace cuánto tiempo ocurrió el accidente?",
  "botones": ["Menos de 1 mes", "1-6 meses", "6-12 meses", "Más de 12 meses"],
  "cambiarEstado": "",
  "casoExcluidoPorTiempo": false,
  "resumen_evaluacion": "Filtrando por rango temporal"
}

Para aprobar y cambiar de fase (SIN BOTONES):
{
  "respuesta_usuario": "Perfecto, tu caso parece viable. Voy a solicitar que envíes los documentos necesarios para la evaluación jurídica.",
  "botones": [],
  "cambiarEstado": "documentacion",
  "casoExcluidoPorTiempo": false,
  "resumen_evaluacion": "Lead calificado. Cumple todos los filtros. Trasladando a fase de documentación."
}

Para rechazar por tiempo (SIN BOTONES):
{
  "respuesta_usuario": "Lamentablemente, los accidentes ocurridos hace más de 18 meses están fuera del alcance de nuestros servicios por prescripción legal.",
  "botones": [],
  "cambiarEstado": "",
  "casoExcluidoPorTiempo": true,
  "resumen_evaluacion": "Lead rechazado. Accidente fuera de rango temporal (Filtro 2)."
}
    \`;

    const mensajeUsuario = historialChat
        .map(fila => \`\${fila.sender === 'user' ? 'Usuario' : 'Sofía'}: \${fila.message}\`)
        .join('\\n');

    const response = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: mensajeUsuario }
        ],
        temperature: 0.7,
        max_tokens: 500
    });

    try {
        // El modelo debe devolver JSON válido
        const respuestaJSON = JSON.parse(response.choices[0].message.content);
        return {
            respuesta: JSON.stringify(respuestaJSON),
            cambiarEstado: respuestaJSON.cambiarEstado || "",
            casoExcluidoPorTiempo: respuestaJSON.casoExcluidoPorTiempo || false
        };
    } catch (error) {
        console.error('Error parseando respuesta JSON de Sofía:', error);
        // Fallback a respuesta texto plano
        return {
            respuesta: response.choices[0].message.content,
            cambiarEstado: "",
            casoExcluidoPorTiempo: false
        };
    }
}
\`\`\`

---

## 🎯 Prompt Específico para Claude (Anthropic)

Si usas Claude API:

\`\`\`javascript
import Anthropic from "@anthropic-ai/sdk";

export async function procesarFiltroConIA_Claude(historialChat) {
    const client = new Anthropic();
    
    const systemPrompt = \`
[Tu prompt de Sofía]

## 🔘 FORMATO DE RESPUESTA

Responde SIEMPRE como JSON puro, sin markdown, sin explicaciones:

{
  "respuesta_usuario": "Tu pregunta aquí",
  "botones": ["Opción 1", "Opción 2"] o [],
  "cambiarEstado": "documentacion" o "",
  "casoExcluidoPorTiempo": false
}
    \`;

    const mensajeUsuario = historialChat
        .map(fila => \`\${fila.sender === 'user' ? 'Usuario' : 'Sofía'}: \${fila.message}\`)
        .join('\\n');

    const response = await client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 500,
        system: systemPrompt,
        messages: [
            { role: "user", content: mensajeUsuario }
        ]
    });

    try {
        const respuestaJSON = JSON.parse(response.content[0].text);
        return {
            respuesta: JSON.stringify(respuestaJSON),
            cambiarEstado: respuestaJSON.cambiarEstado || "",
            casoExcluidoPorTiempo: respuestaJSON.casoExcluidoPorTiempo || false
        };
    } catch (error) {
        console.error('Error parseando respuesta JSON de Claude:', error);
        return {
            respuesta: response.content[0].text,
            cambiarEstado: "",
            casoExcluidoPorTiempo: false
        };
    }
}
\`\`\`

---

## 📚 Recursos Adicionales

- **JSON Validator:** https://jsonlint.com/
- **Prompt Engineering:** https://platform.openai.com/docs/guides/prompt-engineering
- **OpenAI API Docs:** https://platform.openai.com/docs/api-reference/chat
- **Claude API Docs:** https://docs.anthropic.com/

