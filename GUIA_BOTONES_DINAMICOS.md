# 🚀 Guía de Integración Rápida - Sistema de Botones Dinámicos

## Resumen de Cambios Implementados

### 1️⃣ Captura Unificada de Mensajes (`messageHandler.js`)

**Lo que cambió:**
- El sistema ahora detecta automáticamente clics de botones desde `msg.message.buttonsResponseMessage`
- Extrae el texto del botón presionado: `selectedButtonText`
- Lo trata exactamente igual que si fuera un mensaje de texto normal

**Ubicación:**
[messageHandler.js](src/services/messageHandler.js#L205-L235)

**Código clave:**
```javascript
if (messageContent.buttonsResponseMessage) {
    // Usuario presionó un botón interactivo
    tipoMensaje = 'button_click';
    textoUsuario = messageContent.buttonsResponseMessage.selectedButtonText;
}
```

---

### 2️⃣ Función `enviarMensajeConBotones()` (`whatsapp.js`)

**Lo que hace:**
- Genera el payload correcto que Baileys requiere para mensajes interactivos
- Crea botones dinámicamente a partir de un array de strings
- Aplica fallback a texto plano si hay error

**Ubicación:**
[whatsapp.js](src/services/whatsapp.js#L39-L75)

**Firma de función:**
```javascript
export async function enviarMensajeConBotones(
    sock,                    // Socket de Baileys
    jid,                     // JID del destinatario
    textoPrincipal,          // Texto que se muestra
    opciones,                // Array de opciones para botones
    footer = "Tu Caso de Tránsito"  // Footer opcional
)
```

**Payload generado:**
```javascript
{
    text: "¿En qué parte del cuerpo sufriste la lesión?",
    footer: "Tu Caso de Tránsito",
    buttons: [
        { buttonId: "id_opcion_1", buttonText: { displayText: "Cabeza" }, type: 1 },
        { buttonId: "id_opcion_2", buttonText: { displayText: "Tórax" }, type: 1 },
        { buttonId: "id_opcion_3", buttonText: { displayText: "Extremidades" }, type: 1 }
    ],
    headerType: 1
}
```

---

### 3️⃣ Función `procesarRespuestaConBotones()` (`messageHandler.js`)

**Lo que hace:**
- Parsea respuestas JSON de la IA
- Si `botones.length > 0` → Envía mensaje interactivo
- Si `botones.length === 0` → Envía texto plano con efecto humano
- Fallback tolerante si JSON no es válido

**Ubicación:**
[messageHandler.js](src/services/messageHandler.js#L46-L103)

**Lógica:**
```
┌─ Respuesta de IA
│
├─ ¿Es JSON válido?
│  ├─ Sí  → Extrae respuesta_usuario y botones
│  └─ No  → Trata como texto plano
│
├─ ¿botones.length > 0?
│  ├─ Sí  → Llama a enviarMensajeConBotones()
│  └─ No  → Llama a enviarConEfectoHumano()
│
└─ Retorna: { respuesta_usuario, botones }
```

---

## 🔌 Integración en tu Lógica Existente

### En estado "filtrado":
```javascript
// ANTES:
await enviarConEfectoHumano(sock, remoteJid, resultadoIA.respuesta);

// AHORA:
const { respuesta_usuario } = await procesarRespuestaConBotones(
    sock,
    remoteJid,
    resultadoIA.respuesta  // Puede ser JSON o string
);
```

### En estado "documentacion":
```javascript
// ANTES:
await enviarConEfectoHumano(sock, remoteJid, resultadoDoc.respuesta);

// AHORA:
const { respuesta_usuario } = await procesarRespuestaConBotones(
    sock,
    remoteJid,
    resultadoDoc.respuesta  // Puede ser JSON o string
);
```

---

## 📝 Ejemplo: Actualizar prompts de OpenAI

### Ubicación:
[src/services/openai.js](src/services/openai.js)

### Cambio necesario en `procesarFiltroConIA()`:

Busca la sección `const systemPrompt = ` y añade al final de las instrucciones:

```javascript
---

## FORMATO DE RESPUESTA (OBLIGATORIO)

Siempre responde en formato JSON válido:
{
  "respuesta_usuario": "Tu respuesta aquí",
  "botones": ["Opción 1", "Opción 2"] o []
}

REGLAS:
1. Si es pregunta con opciones claras → Incluye botones
2. Si es pregunta abierta → Usa "botones": []
3. El JSON DEBE ser 100% válido
4. Máximo 5 botones por pregunta

EJEMPLOS DE RESPUESTAS:

CON BOTONES:
{
  "respuesta_usuario": "¿Sufriste una lesión física en el accidente?",
  "botones": ["Sí, me lesioné", "No, solo daños al vehículo"]
}

SIN BOTONES:
{
  "respuesta_usuario": "Por favor, describe brevemente cómo ocurrió el accidente.",
  "botones": []
}
```

---

## ✅ Checklist de Pruebas

- [ ] Captura de texto normal funciona
- [ ] Captura de clics de botones funciona
- [ ] Las respuestas JSON de IA son parseadas correctamente
- [ ] Se envían botones cuando `botones.length > 0`
- [ ] Se envía texto plano cuando `botones.length === 0`
- [ ] El fallback a texto plano funciona si JSON es inválido
- [ ] Los mensajes se guardan en la BD correctamente
- [ ] El historial de chat se mantiene consistente

---

## 🔍 Monitoreo y Debugging

### Ver logs de envío de botones:
```bash
# En los logs de consola, busca:
"🔘 Clic en botón detectado:"          # Captura de botón
"✅ Respuesta de IA parseada como JSON" # Parseo exitoso
"🔘 Enviando respuesta con N botones"   # Envío con botones
"📝 Enviando respuesta como texto plano" # Envío sin botones
```

### Troubleshooting:

| Problema | Solución |
|----------|----------|
| Los botones no aparecen | Verifica que la IA devuelva JSON válido con `botones: [...]` |
| Se envía solo texto | Revisa si `botones` está vacío `[]` en la respuesta JSON |
| Error en captura de botón | Verifica en Chrome DevTools que `buttonsResponseMessage` existe |
| JSON inválido | Asegúrate de que OpenAI responde con JSON sin comentarios |

---

## 🎓 Referencia Completa

Para documentación detallada de estructura y ejemplos:
→ Ver [ESTRUCTURA_RESPUESTAS_IA.md](ESTRUCTURA_RESPUESTAS_IA.md)

Para detalles técnicos de Baileys:
→ Ver documentación oficial de [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)

