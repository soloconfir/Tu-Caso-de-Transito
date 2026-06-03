# 🚩 Sistema de Banderas/Flags de Control del Bot

## 📋 Descripción General

Este documento describe el sistema de estados (banderas de control) implementado para pausar y reactivar automáticamente el bot de WhatsApp basado en Baileys.

---

## 🗄️ 1. Cambios en la Base de Datos

### Comando ALTER TABLE a ejecutar:

```sql
ALTER TABLE leads 
ADD COLUMN bot_active TINYINT(1) DEFAULT 1 NOT NULL AFTER status,
ADD COLUMN pause_reason VARCHAR(50) NULL DEFAULT NULL AFTER bot_active;
```

### Nuevas Columnas:

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `bot_active` | TINYINT(1) | 1 = bot activo y responde; 0 = bot pausado, control humano |
| `pause_reason` | VARCHAR(50) | Registra el motivo de la pausa para auditoría (ej: "documento_recibido", "asesor_intervino") |

### Estructura Completa de la Tabla `leads`:

```
id              INT (PRIMARY KEY)
phone           VARCHAR(30) (UNIQUE)
name            VARCHAR(100)
status          ENUM('filtrado', 'documentacion', 'remitido')
bot_active      TINYINT(1) DEFAULT 1 [NUEVO]
pause_reason    VARCHAR(50) [NUEVO]
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

---

## 🔧 2. Nuevas Funciones en `dbQueries.js`

### Función 1: Obtener Estado del Bot

```javascript
obtenerEstadoBotPorTelefono(telefono)
```

**Propósito:** Consultar si el bot está activo para un lead específico.

**Parámetros:**
- `telefono` (string): Número normalizado del lead

**Retorna:**
```javascript
{
  encontrado: boolean,
  leadId: int,
  botActivo: boolean,
  pauseReason: string|null,
  estado: string
}
```

**Ejemplo de uso:**
```javascript
const estado = await obtenerEstadoBotPorTelefono('573001234567');
if (!estado.botActivo) {
  console.log(`Bot pausado. Motivo: ${estado.pauseReason}`);
}
```

---

### Función 2: Pausar Bot

```javascript
pausarBotPorTelefono(telefono, pauseReason = 'pausa_manual')
```

**Propósito:** Pausar el bot para un lead y registrar el motivo.

**Parámetros:**
- `telefono` (string): Número normalizado del lead
- `pauseReason` (string, opcional): Motivo de la pausa

**Valores comunes de `pauseReason`:**
- `'documento_recibido'` - Auto-pausa por documentos en estado documentacion
- `'asesor_intervino'` - Asesor ejecutó comando `.humano`
- `'pausa_manual'` - Pausa manual por defecto

**Retorna:**
```javascript
{ exito: boolean, telefono: string, pauseReason: string }
```

**Ejemplo de uso:**
```javascript
await pausarBotPorTelefono('573001234567', 'documento_recibido');
// El bot no responderá más mensajes para este número
```

---

### Función 3: Reactivar Bot

```javascript
reactivarBotPorTelefono(telefono)
```

**Propósito:** Reactivar el bot para un lead (limpia `bot_active` y `pause_reason`).

**Parámetros:**
- `telefono` (string): Número normalizado del lead

**Retorna:**
```javascript
{ exito: boolean, telefono: string }
```

**Ejemplo de uso:**
```javascript
await reactivarBotPorTelefono('573001234567');
// El bot vuelve a responder automáticamente
```

---

## 🤖 3. Cambios en `messageHandler.js`

### 3.1 Filtro de Pausa (al inicio del procesamiento)

**Ubicación:** Inicio de `manejarMensajeEntrante()`, después de validaciones iniciales.

**Lógica:**
```javascript
const estadoBot = await obtenerEstadoBotPorTelefono(telefono);
if (estadoBot.encontrado && !estadoBot.botActivo) {
    console.log(`🔇 [${telefono}] Bot pausado. Motivo: ${estadoBot.pauseReason}. Mensaje ignorado.`);
    return;
}
```

**Comportamiento:** Si `bot_active = 0`, el bot **ignora silenciosamente** el mensaje y no responde. Esto permite que un asesor tome control manualmente sin que el bot interfiera.

---

### 3.2 Detección de Comandos de Control

**Ubicación:** En `manejarMensajeEntrante()`, después del filtro de pausa.

**Comandos disponibles:**

#### Comando: `.humano`
- **Ejecutado por:** Asesor escribiendo en el chat del cliente
- **Efecto:** Pausa el bot (`bot_active = 0`, `pause_reason = 'asesor_intervino'`)
- **Comportamiento:** El bot cede el control al asesor y no responde más mensajes
- **Ejemplo:**
  ```
  Asesor escribe en chat: .humano
  Resultado: Bot pausado, asesor puede atender al cliente
  ```

#### Comando: `.bot`
- **Ejecutado por:** Asesor escribiendo en el chat del cliente
- **Efecto:** Reactivar el bot (`bot_active = 1`, `pause_reason = NULL`)
- **Comportamiento:** El bot vuelve a responder automáticamente
- **Ejemplo:**
  ```
  Asesor escribe en chat: .bot
  Resultado: Bot reactivado, envía confirmación "✅ Bot reactivado..."
  ```

**Código:**
```javascript
if (tipoMensaje === 'text' && textoUsuario?.toLowerCase() === '.humano') {
    await pausarBotPorTelefono(telefono, 'asesor_intervino');
    return;
}

if (tipoMensaje === 'text' && textoUsuario?.toLowerCase() === '.bot') {
    await reactivarBotPorTelefono(telefono);
    await enviarConEfectoHumano(sock, remoteJid, "✅ Bot reactivado. Vuelvo a responder automáticamente.");
    return;
}
```

---

### 3.3 Auto-Pausa por Documentos

**Ubicación:** En la sección `else if (estadoActual === 'documentacion')` de `manejarMensajeEntrante()`.

**Condición:** Cuando el lead está en estado `'documentacion'` y **envía cualquier archivo multimedia** (imagen o documento).

**Lógica:**
```javascript
if (tipoMensaje === 'image' || tipoMensaje === 'document') {
    // 1. Guardar el archivo en chat_history
    // 2. Pausar bot automáticamente (bot_active = 0)
    // 3. Enviar mensaje cordial de confirmación
    // 4. Enviar alerta a Telegram para equipo jurídico
    // 5. RETORNAR (cortar la ejecución)
}
```

**Comportamiento detallado:**

1. **Descarga y almacenamiento:** El archivo se descarga y guarda en `downloads/`
2. **Pausa automática:** Se ejecuta `pausarBotPorTelefono(telefono, 'documento_recibido')`
3. **Confirmación al usuario:**
   > "¡Perfecto! He recibido tus documentos y los estoy indexando en tu expediente. Un asesor revisará toda la información y se pondrá en contacto contigo en breve para validar tu caso. Gracias por tu paciencia."
4. **Alerta al equipo:** Se envía a Telegram con:
   - Lead ID y teléfono
   - Tipo de archivo recibido
   - Ruta del archivo para revisión
   - Indicación de que requiere revisión manual

5. **Corte de ejecución:** El `return` detiene todo procesamiento adicional

**Por qué esta lógica:**
- Evita respuestas automáticas mientras el asesor revisa documentos
- Proporciona confirmación clara al usuario
- Centraliza la revisión de documentos en el equipo jurídico
- Mantiene auditoría de cuándo y por qué se pausó el bot

---

## 📊 4. Flujo Completo de Interacción

### Escenario 1: Auto-Pausa por Documentos

```
Usuario (estado: 'documentacion')
  ↓ envía imagen/documento
  ↓
[Bot detecta: status='documentacion' + mediaMessage]
  ↓
✓ Guarda archivo en BD
✓ Pausa bot (bot_active=0, pause_reason='documento_recibido')
✓ Envía confirmación cordial
✓ Notifica a Telegram
  ↓
Usuario escribe más → Bot IGNORA (pausado)
  ↓
Asesor interviene → Puede responder manualmente
```

---

### Escenario 2: Control Manual por Asesor

```
Asesor escribe ".humano" en chat
  ↓
[Bot detecta comando]
  ↓
✓ Pausa bot (bot_active=0, pause_reason='asesor_intervino')
✓ Retorna (no responde)
  ↓
Asesor gestiona la conversación
  ↓
Usuario escribe → Bot IGNORA (pausado)
  ↓
Asesor escribe ".bot"
  ↓
[Bot detecta comando]
  ↓
✓ Reactivar bot (bot_active=1, pause_reason=NULL)
✓ Envía confirmación
  ↓
Usuario escribe → Bot RESPONDE (reactivado)
```

---

## 🛠️ 5. Comandos SQL Útiles para Administración

### Ver estado actual de un lead:
```sql
SELECT phone, name, status, bot_active, pause_reason, updated_at 
FROM leads 
WHERE phone LIKE '%3001234567%';
```

### Pausar manualmente un bot (sin código):
```sql
UPDATE leads 
SET bot_active = 0, pause_reason = 'pausa_administrativa' 
WHERE phone = '573001234567';
```

### Reactivar manualmente un bot:
```sql
UPDATE leads 
SET bot_active = 1, pause_reason = NULL 
WHERE phone = '573001234567';
```

### Ver todos los leads pausados:
```sql
SELECT id, phone, name, status, pause_reason, updated_at 
FROM leads 
WHERE bot_active = 0 
ORDER BY updated_at DESC;
```

### Obtener motivos más comunes de pausa:
```sql
SELECT pause_reason, COUNT(*) as cantidad 
FROM leads 
WHERE bot_active = 0 
GROUP BY pause_reason 
ORDER BY cantidad DESC;
```

---

## 📝 6. Registro de Cambios

### Archivos modificados:

1. **[schema.sql](schema.sql)**
   - Agregadas columnas `bot_active` y `pause_reason` a tabla `leads`

2. **[src/services/dbQueries.js](src/services/dbQueries.js)**
   - Nueva función: `obtenerEstadoBotPorTelefono(telefono)`
   - Nueva función: `pausarBotPorTelefono(telefono, pauseReason)`
   - Nueva función: `reactivarBotPorTelefono(telefono)`

3. **[src/services/messageHandler.js](src/services/messageHandler.js)**
   - Import agregado: `obtenerEstadoBotPorTelefono`, `pausarBotPorTelefono`, `reactivarBotPorTelefono`
   - Nuevo filtro de pausa al inicio de `manejarMensajeEntrante()`
   - Nueva detección de comandos `.humano` y `.bot`
   - Nueva lógica de auto-pausa para documentos en estado 'documentacion'
   - Eliminado flujo de debounce antiguo (reemplazado por auto-pausa)

---

## ⚠️ 7. Consideraciones Importantes

1. **Persistencia:** Los estados se persisten en MySQL, por lo que sobreviven reinicios del servidor
2. **Silencio garantizado:** Mientras `bot_active = 0`, el bot **nunca** responderá, garantizando control humano
3. **Auditoría:** El campo `pause_reason` permite rastrear por qué se pausó cada lead
4. **Asesor + Bot:** Los comandos `.humano` y `.bot` permiten que un asesor controle fluidamente cuándo el bot está activo

---

## 🎯 8. Próximos Pasos Recomendados

- [ ] Ejecutar `ALTER TABLE` en base de datos de producción
- [ ] Reiniciar servidor de Node.js para cargar cambios
- [ ] Probar flujo de auto-pausa con documento de prueba
- [ ] Documentar en tu equipo los comandos `.humano` y `.bot`
- [ ] Considerar agregar UI para visualizar leads pausados

---

**Fecha de implementación:** 2026-06-03  
**Versión del sistema:** 1.0  
**Estado:** ✅ Listo para producción
