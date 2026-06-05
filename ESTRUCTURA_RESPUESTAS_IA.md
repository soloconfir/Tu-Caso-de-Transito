# 📋 Estructura de Respuestas de IA para Sistema de Botones Dinámicos

## Objetivo
Este documento especifica cómo tu IA (OpenAI/Claude) debe estructurar sus respuestas para que el sistema backend interprete automáticamente cuándo enviar botones interactivos y cuándo enviar texto plano.

---

## 📦 Estructura JSON Esperada

La IA debe devolver sus respuestas como un objeto JSON con dos propiedades:

```json
{
  "respuesta_usuario": "Texto visible para el usuario en WhatsApp",
  "botones": ["Opción 1", "Opción 2", "Opción 3"]
}
```

### Propiedades Requeridas:

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `respuesta_usuario` | String | El texto que se mostrará en WhatsApp al usuario |
| `botones` | Array de Strings | Lista de opciones para botones interactivos |

---

## 🎯 Casos de Uso

### Caso 1: Pregunta con Múltiples Opciones (CON BOTONES)

**Ejemplo de respuesta de IA:**
```json
{
  "respuesta_usuario": "¿En qué parte del cuerpo sufriste la lesión?",
  "botones": [
    "Cabeza o cuello",
    "Tórax o abdomen",
    "Extremidades superiores",
    "Extremidades inferiores",
    "Múltiples zonas"
  ]
}
```

**Resultado en WhatsApp:** 
- Se mostrará el texto "¿En qué parte del cuerpo sufriste la lesión?" con 5 botones interactivos debajo
- El usuario puede hacer clic en uno de los botones
- El backend capturará automáticamente el texto del botón presionado

---

### Caso 2: Pregunta Abierta (SIN BOTONES)

**Ejemplo de respuesta de IA:**
```json
{
  "respuesta_usuario": "Por favor, describe brevemente cómo ocurrió el accidente y qué circunstancias lo provocaron.",
  "botones": []
}
```

**Resultado en WhatsApp:**
- Se mostrará solo el texto como mensaje tradicional
- El usuario puede escribir una respuesta libre (sin restricción a botones)

---

### Caso 3: Relato de Lesiones (SIN BOTONES)

**Ejemplo de respuesta de IA:**
```json
{
  "respuesta_usuario": "Entendido. Por favor cuéntame en detalle qué lesiones sufriste, qué tratamientos has recibido y si continúas con dolor o limitaciones.",
  "botones": []
}
```

---

### Caso 4: Fase de Documentación (CON BOTONES)

**Ejemplo de respuesta de IA:**
```json
{
  "respuesta_usuario": "Perfecto. Ahora necesito que me envíes los siguientes documentos. ¿Cuál deseas enviar primero?",
  "botones": [
    "Croquis del accidente",
    "Historia clínica / Epicrisis",
    "Otro documento"
  ]
}
```

---

## 🔄 Flujo de Procesamiento en el Backend

```
┌─────────────────────────┐
│   IA devuelve JSON      │
│  con respuesta y botones│
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Backend parsea JSON    │
└────────────┬────────────┘
             │
             ▼
      ¿botones.length > 0?
        /            \
      Sí              No
      │               │
      ▼               ▼
  Envía con      Envía como
  botones        texto plano
```

---

## ⚠️ Notas Importantes

1. **Validación Tolerante:** Si la IA envía solo un string en lugar de JSON, el sistema automáticamente lo tratará como texto plano (sin botones).

2. **Fallback:** Si hay error al parsear JSON, el backend enviará la respuesta como texto plano.

3. **Máximo de Botones:** Baileys soporta hasta 3 botones por mensaje de forma óptima. Se recomienda usar máximo 5 opciones.

4. **Guardado en BD:** El backend siempre guarda en la base de datos solo el texto (`respuesta_usuario`), no los botones.

5. **Captura de Clics:** Cuando el usuario presiona un botón, el backend captura automáticamente el `selectedButtonText` y lo trata como un mensaje normal del usuario.

---

## 🔧 Implementación en tu IA

### Prompt para OpenAI/Claude:

Añade esto a tu system prompt de la IA:

```
## FORMATO DE RESPUESTA OBLIGATORIO

Siempre responde en JSON con esta estructura exacta:
{
  "respuesta_usuario": "Tu respuesta aquí",
  "botones": ["Opción 1", "Opción 2"] o []
}

REGLAS:
- "respuesta_usuario" SIEMPRE es un string
- "botones" SIEMPRE es un array (puede estar vacío [])
- Si es pregunta abierta, usa "botones": []
- Si ofreces opciones, coloca máximo 3-5 botones
- El JSON debe ser 100% válido (sin comentarios, comillas escapadas correctamente)

EJEMPLOS:

Pregunta cerrada (CON botones):
{
  "respuesta_usuario": "¿Tenías otros pasajeros en el vehículo?",
  "botones": ["Sí", "No", "Prefiero no responder"]
}

Pregunta abierta (SIN botones):
{
  "respuesta_usuario": "Cuéntame qué sucedió después del impacto.",
  "botones": []
}
```

---

## 📊 Ejemplo de Conversación Completa

```
🤖 IA → Backend (JSON):
{
  "respuesta_usuario": "Perfecto, recibí que el accidente fue hace 3 meses. ¿En qué ciudad ocurrió?",
  "botones": ["Bogotá", "Medellín", "Cali", "Otra ciudad"]
}

WhatsApp Usuario ve:
┌─────────────────────────────────────────┐
│ Perfecto, recibí que el accidente fue   │
│ hace 3 meses. ¿En qué ciudad ocurrió?   │
│                                         │
│ [Bogotá]                                │
│ [Medellín]                              │
│ [Cali]                                  │
│ [Otra ciudad]                           │
│ Tu Caso de Tránsito         (footer)    │
└─────────────────────────────────────────┘

👤 Usuario presiona [Bogotá]

Backend captura:
- tipoMensaje: "button_click"
- textoUsuario: "Bogotá"
(Se trata exactamente igual que si el usuario hubiera escrito "Bogotá" como texto)

🤖 IA → Backend (JSON):
{
  "respuesta_usuario": "Gracias. ¿Cuál era la placa del otro vehículo o tienes el reporte de tránsito?",
  "botones": []
}

WhatsApp Usuario ve:
┌─────────────────────────────────────────┐
│ Gracias. ¿Cuál era la placa del otro    │
│ vehículo o tienes el reporte de tránsito│
│                                         │
│ (mensaje de texto libre, sin botones)   │
└─────────────────────────────────────────┘

👤 Usuario escribe respuesta libre
```

---

## 🚀 Próximos Pasos

1. **Actualiza tus prompts de OpenAI/Claude** con el formato JSON requerido
2. **Prueba el flujo** enviando un mensaje a través de WhatsApp
3. **Monitorea los logs** para verificar que la captura de botones funciona
4. **Itera sobre la UX** según feedback de los usuarios

