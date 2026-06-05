# ✅ Guía de Validación del Sistema de Botones Dinámicos

## Objetivo

Este documento te ayuda a verificar que todas las funcionalidades del sistema de botones dinámicos están funcionando correctamente.

---

## 🔍 Prueba 1: Captura de Texto Normal

**Objetivo:** Verificar que los mensajes de texto normal se capturan correctamente

### Pasos:
1. Inicia tu bot en terminal: `npm start` o `node index.js`
2. Escanea el QR de WhatsApp
3. Envía un mensaje de texto simple (ej: "Hola")

### Resultado esperado:
```
📩 [123456789] Estado: filtrado | Tipo: text | Msg: Hola
🧠 Consultando a Sofía (IA) para Lead ID: 1...
```

**Checklist:**
- ✓ El bot recibe el mensaje
- ✓ Tipo de mensaje es `text`
- ✓ El texto capturado es exacto

---

## 🔍 Prueba 2: Captura de Clics de Botones

**Objetivo:** Verificar que los clics en botones interactivos se capturan como texto

### Pasos:
1. El bot envía un mensaje con botones (por ejemplo, preguntas de filtrado)
2. Presiona uno de los botones interactivos en WhatsApp

### Resultado esperado:
```
🔘 Clic en botón detectado: "Opción seleccionada"
📩 [123456789] Estado: filtrado | Tipo: button_click | Msg: Opción seleccionada
🧠 Consultando a Sofía (IA) para Lead ID: 1...
```

**Checklist:**
- ✓ El bot detecta el clic como `button_click`
- ✓ El texto del botón se captura correctamente
- ✓ Se procesa como un mensaje normal del usuario

---

## 🔍 Prueba 3: Envío de Mensaje con Botones

**Objetivo:** Verificar que el bot envía correctamente mensajes interactivos

### Pasos:
1. Configura la IA para devolver una respuesta JSON con botones:
```json
{
  "respuesta_usuario": "¿Sufriste una lesión?",
  "botones": ["Sí, me lesioné", "No, solo daños materiales"]
}
```
2. Observa el mensaje en WhatsApp

### Resultado esperado en logs:
```
✅ Respuesta de IA parseada como JSON. Botones: 2
🔘 Enviando respuesta con 2 botones.
🔘 Enviando mensaje con 2 botones a 123456789@s.whatsapp.net
```

### Resultado esperado en WhatsApp:
```
┌─────────────────────────────┐
│ ¿Sufriste una lesión?       │
│                             │
│ [Sí, me lesioné]            │
│ [No, solo daños materiales] │
│ Tu Caso de Tránsito (footer)│
└─────────────────────────────┘
```

**Checklist:**
- ✓ Los botones aparecen en WhatsApp
- ✓ El texto principal es visible
- ✓ El footer "Tu Caso de Tránsito" aparece

---

## 🔍 Prueba 4: Envío de Mensaje sin Botones (Texto Plano)

**Objetivo:** Verificar que mensajes sin botones se envían como texto normal

### Pasos:
1. Configura la IA para devolver una respuesta JSON sin botones:
```json
{
  "respuesta_usuario": "Por favor, cuéntame qué sucedió en el accidente.",
  "botones": []
}
```

### Resultado esperado en logs:
```
✅ Respuesta de IA parseada como JSON. Botones: 0
📝 Enviando respuesta como texto plano.
```

### Resultado esperado en WhatsApp:
```
┌─────────────────────────────┐
│ Por favor, cuéntame qué     │
│ sucedió en el accidente.    │
│                             │
│ (sin botones, texto normal) │
└─────────────────────────────┘
```

**Checklist:**
- ✓ El mensaje se envía sin botones
- ✓ Aparece el efecto "Escribiendo..."
- ✓ El texto se muestra de forma normal

---

## 🔍 Prueba 5: Parseo de JSON Inválido

**Objetivo:** Verificar que el fallback funciona si la IA devuelve JSON inválido

### Pasos:
1. Simula una respuesta inválida (por debugging en openai.js):
```
"Esta es una respuesta que no es JSON válido {malformado"
```

### Resultado esperado en logs:
```
ℹ️ Respuesta de IA no es JSON válido, enviando como texto plano.
📝 Enviando respuesta como texto plano.
```

### Resultado esperado en WhatsApp:
```
El mensaje se envía como texto plano sin botones
```

**Checklist:**
- ✓ El sistema no se rompe
- ✓ Se envía como fallback a texto
- ✓ El usuario recibe la respuesta

---

## 🔍 Prueba 6: Guardado en Base de Datos

**Objetivo:** Verificar que los mensajes y botones se guardan correctamente

### Pasos:
1. Completa varias rondas de conversación con botones
2. Revisa la tabla `chat_history` en MySQL

### Resultado esperado en MySQL:
```sql
SELECT * FROM chat_history WHERE lead_id = 1 ORDER BY created_at DESC LIMIT 10;
```

```
| id  | lead_id | sender | message_type | message                          | created_at          |
|-----|---------|--------|--------------|----------------------------------|-------------------|
| 5   | 1       | bot    | text         | ¿Sufriste una lesión?            | 2026-01-15 10:00  |
| 4   | 1       | user   | button_click | Sí, me lesioné                   | 2026-01-15 10:05  |
| 3   | 1       | bot    | text         | Por favor, cuéntame...           | 2026-01-15 10:10  |
| 2   | 1       | user   | text         | Texto libre del usuario          | 2026-01-15 10:15  |
| 1   | 1       | bot    | text         | Perfecto, tu caso es viable...   | 2026-01-15 10:20  |
```

**Checklist:**
- ✓ `message_type` es `text` para respuestas de bot
- ✓ `message_type` es `button_click` para clics en botones
- ✓ `message_type` es `text` para respuestas libres del usuario
- ✓ El `message` contiene solo el texto (no los botones)
- ✓ Todos los mensajes están ordenados cronológicamente

---

## 🔍 Prueba 7: Historial Conversacional

**Objetivo:** Verificar que la IA recibe el historial correcto

### Pasos:
1. Completa 3-4 mensajes con el bot
2. En los logs, busca el historial que se envía a la IA

### Resultado esperado en logs:
```
Historial enviado a Sofía (IA):
[
  { sender: 'user', message: 'Hola' },
  { sender: 'bot', message: '¿Sufriste una lesión?' },
  { sender: 'user', message: 'Sí, me lesioné' },
  { sender: 'bot', message: 'Hace cuánto tiempo...' },
  { sender: 'user', message: 'Hace 3 meses' }
]
```

**Checklist:**
- ✓ El historial incluye todos los mensajes
- ✓ El orden es correcto (FIFO)
- ✓ No hay botones en el historial (solo texto)

---

## 🚨 Troubleshooting

### Problema: Los botones no aparecen en WhatsApp

**Solución 1: Verifica que la IA devuelve JSON**
```bash
# En logs busca:
"✅ Respuesta de IA parseada como JSON. Botones: X"
```
Si ves `Botones: 0`, la IA está devolviendo `[]`

**Solución 2: Valida el JSON**
```javascript
// Añade en messageHandler.js temporalmente:
console.log("JSON respuesta:", JSON.stringify(resultadoIA, null, 2));
```

**Solución 3: Verifica que Baileys se inicializó correctamente**
```bash
# El log debe mostrar:
"✅ ¡Agente de WhatsApp conectado con éxito y listo para procesar leads!"
```

---

### Problema: El bot envía el mismo mensaje dos veces

**Causa:** Probablemente hay dos instancias del bot corriendo

**Solución:**
```bash
# Mata procesos de Node existentes
pkill -f "node"

# Inicia de nuevo
npm start
```

---

### Problema: Error "Cannot read property 'buttonsResponseMessage' of undefined"

**Causa:** Estructura de mensaje diferente a la esperada

**Solución:** Verifica que tienes la última versión de Baileys:
```bash
npm install @whiskeysockets/baileys@latest
```

---

### Problema: Los clics de botones no se capturan

**Causa:** El mensaje llegó pero `buttonsResponseMessage` no existe

**Solución:** Añade debugging en messageHandler.js:
```javascript
console.log("messageContent keys:", Object.keys(messageContent));
console.log("Full messageContent:", JSON.stringify(messageContent, null, 2));
```

---

## 📊 Checklist Final de Validación

Antes de dar por completado el sistema, verifica:

- [ ] Los mensajes de texto se capturan correctamente
- [ ] Los clics de botones se capturan como `button_click`
- [ ] La IA devuelve JSON válido con `respuesta_usuario` y `botones`
- [ ] Los mensajes con botones se envían correctamente
- [ ] Los mensajes sin botones se envían como texto plano
- [ ] El fallback a texto funciona si hay error en JSON
- [ ] Todos los mensajes se guardan en la BD
- [ ] El historial conversacional es correcto
- [ ] El comando `.humano` pausar el bot
- [ ] El comando `.bot` reactiva el bot
- [ ] El estado del lead se actualiza correctamente
- [ ] No hay errores en la consola

---

## 🎓 Próximos Pasos

Una vez validado:

1. **Optimiza los prompts de IA** para mejorar calidad de preguntas
2. **Ajusta los botones** según feedback de usuarios
3. **Añade más estados** si necesitas más fases en tu embudo
4. **Escala con documentación** de nuevas características
5. **Monitorea métricas** de conversión por estado

