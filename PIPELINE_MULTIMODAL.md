# 📋 Pipeline Multimodal de Análisis Documental con OpenAI

## 📌 Descripción General

Sistema automatizado que procesa documentos multimedia (imágenes y PDFs) recibidos por WhatsApp en la fase de `documentacion`, clasificándolos, extrayendo información clave y generando análisis con la API de OpenAI (Vision + GPT-4).

Los resultados se guardan en la tabla `lead_documents` con auditoría completa para el equipo jurídico.

---

## 🏗️ Arquitectura del Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  Usuario envía documento en WhatsApp (estado: documentacion)│
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  Baileys detecta: imageMessage | documentMessage             │
│  → downloadMediaMessage() descarga buffer                    │
│  → Guarda en ./downloads/ con nombre único                  │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  messageHandler.js → Pausa automática del bot                │
│  pausarBotPorTelefono(telefono, 'documento_recibido')       │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  📋 PIPELINE MULTIMODAL INICIA                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  openai.js → analizarDocumentoMultimodal()           │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
          ┌────────────┴────────────┐
          ↓                         ↓
    ┌──────────────┐        ┌──────────────┐
    │   IMAGEN     │        │     PDF      │
    │  (JPEG/PNG)  │        │  (PDF)       │
    └──────────────┘        └──────────────┘
          ↓                         ↓
    • Base64                • pdf-parse
    • Enviar a IA           • Extraer texto
    • Vision API            • Enviar a IA
          │                         │
          └────────────┬────────────┘
                       ↓
    ┌─────────────────────────────────────┐
    │  OpenAI GPT-4o (Vision)              │
    │  System Prompt: Clasificar documento │
    │  Extraer entidades (implicados,     │
    │  placas, fechas, aseguradoras)      │
    │  Evaluar viabilidad del caso        │
    └────────────────┬────────────────────┘
                     ↓
    ┌─────────────────────────────────────┐
    │  Response JSON:                      │
    │  {                                   │
    │    "tipo_documento": "Croquis",      │
    │    "entidades_clave": { ... },       │
    │    "resumen_ejecutivo": "...",       │
    │    "caso_viable": true               │
    │  }                                   │
    └────────────────┬────────────────────┘
                     ↓
    ┌─────────────────────────────────────┐
    │  dbQueries.js                        │
    │  guardarDocumentoAnalizadoEnExpediente()
    │  → INSERT INTO lead_documents        │
    └────────────────┬────────────────────┘
                     ↓
    ┌─────────────────────────────────────┐
    │  Telegram Alerta:                    │
    │  • Tipo de documento                │
    │  • Entidades detectadas             │
    │  • Resumen ejecutivo                │
    │  • Viabilidad (✓/✗)                 │
    └─────────────────────────────────────┘
```

---

## 🔧 Componentes Principales

### 1. **openai.js** → `analizarDocumentoMultimodal(filePath, mimeType)`

**Propósito:** Procesar cualquier documento (imagen o PDF) y retornar análisis estructurado.

**Parámetros:**
```javascript
filePath    : string   // Ruta local del archivo (ej: "downloads/lead_123_1234567890.jpg")
mimeType    : string   // Tipo MIME ("image/jpeg", "image/png", "application/pdf")
```

**Retorna:**
```javascript
{
  tipo_documento: string,           // "Croquis" | "Cédula" | "Historia Clínica" | "Fotos del Accidente" | "Desconocido"
  entidades_clave: {
    implicados: [string],           // Nombres de personas mencionadas
    placas: [string],               // Placas de vehículos
    aseguradoras: [string],         // Nombres de aseguradoras
    fechas: [string],               // Fechas encontradas
    lugares: [string]               // Ubicaciones relevantes
  },
  resumen_ejecutivo: string,        // Max 3 líneas con hallazgos críticos
  caso_viable: boolean,             // true = aporta valor | false = requiere revisión
  timestamp: string                 // ISO 8601 timestamp
}
```

**Flujo Interno:**

```javascript
// RAMA 1: Si es imagen (JPEG/PNG)
const buffer = fs.readFileSync(filePath);
const base64 = buffer.toString('base64');
// Enviar a OpenAI con: image_url { url: "data:image/jpeg;base64,..." }

// RAMA 2: Si es PDF
const PdfParse = (await import('pdf-parse')).default;
const buffer = fs.readFileSync(filePath);
const dataPdf = await PdfParse(buffer);
const textoExtraido = dataPdf.text;
// Enviar texto a OpenAI
```

**System Prompt clave:**
- Clasificación estricta de documentos
- Extracción de entidades: nombres, placas, aseguradoras, fechas
- Evaluación de viabilidad para reclamación
- Respuesta **obligatoriamente en JSON**

**Ejemplo de uso:**
```javascript
const analisis = await analizarDocumentoMultimodal(
  'downloads/lead_42_1717416600000.pdf',
  'application/pdf'
);

// Resultado:
{
  tipo_documento: 'Croquis',
  entidades_clave: {
    implicados: ['Juan Pérez', 'María García'],
    placas: ['ABC-123', 'XYZ-789'],
    aseguradoras: [],
    fechas: ['2026-06-03'],
    lugares: ['Cra. 7 con Calle 50']
  },
  resumen_ejecutivo: 'Croquis oficial del accidente con dos vehículos...',
  caso_viable: true,
  timestamp: '2026-06-03T14:30:00Z'
}
```

---

### 2. **dbQueries.js** → Tres funciones nuevas

#### A. `guardarDocumentoAnalizadoEnExpediente(leadId, fileName, documentType, aiAnalysis)`

**Propósito:** Persistir análisis en tabla `lead_documents`.

**Parámetros:**
```javascript
leadId          : number   // ID del lead en tabla leads
fileName        : string   // Ruta local del archivo guardado
documentType    : string   // Tipo clasificado (ej: "Croquis")
aiAnalysis      : object   // Objeto retornado por analizarDocumentoMultimodal()
```

**Retorna:**
```javascript
{
  exito: boolean,
  documentoId: number,    // ID insertado en tabla lead_documents
  leadId: number,
  tipo: string
}
```

**Query SQL ejecutada:**
```sql
INSERT INTO lead_documents (lead_id, file_name, document_type, ai_summary)
VALUES (?, ?, ?, ?)
```

Donde `ai_summary` es un JSON stringificado con el análisis completo.

---

#### B. `obtenerDocumentosDelLead(leadId)`

**Propósito:** Consultar todos los documentos analizados de un lead.

**Retorna:**
```javascript
{
  encontrado: boolean,
  total: number,
  documentos: [
    {
      id: number,
      archivo: string,
      tipo: string,
      resumen: object,          // Parsed JSON del análisis
      cargadoEn: timestamp
    }
  ]
}
```

---

### 3. **messageHandler.js** → Integración en flujo

**Ubicación:** En el bloque de `estado === 'documentacion'` cuando `tipoMensaje === 'image' || tipoMensaje === 'document'`

**Flujo:**
```javascript
1. Detectar archivo multimedia en estado 'documentacion'
2. Descargar y guardar en ./downloads/
3. Insertar en chat_history (user message)
4. Pausar bot automáticamente
5. Enviar confirmación al usuario
6. ✅ NUEVA: Llamar a analizarDocumentoMultimodal()
7. ✅ NUEVA: Guardar en lead_documents con guardarDocumentoAnalizadoEnExpediente()
8. ✅ NUEVA: Enviar alerta Telegram enriquecida con análisis
9. Manejar errores sin interrumpir el flujo (try/catch)
10. Return para cortar ejecución
```

**Manejo de Errores:**
```javascript
try {
  const analisisMultimodal = await analizarDocumentoMultimodal(rutaArchivoLocal, mimeType);
  const docGuardado = await guardarDocumentoAnalizadoEnExpediente(leadId, ..., analisisMultimodal);
  // Enviar alerta con análisis
} catch (analisiaError) {
  // Log del error
  // Alerta Telegram indicando fallo en análisis
  // ⚠️ NO pausar el flujo: documento se guardó pero sin análisis automático
}
```

---

## 🗄️ Tabla `lead_documents` (Estructura)

```sql
CREATE TABLE lead_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lead_id INT NOT NULL,
    file_name VARCHAR(255) NOT NULL,           -- Ruta: ./downloads/lead_123_timestamp.ext
    document_type VARCHAR(100) NULL,           -- "Croquis", "Cédula", etc.
    ai_summary TEXT NULL,                      -- JSON stringificado con análisis
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);
```

**Ejemplo de `ai_summary` guardado:**
```json
{
  "tipo_documento": "Croquis",
  "entidades_clave": {
    "implicados": ["Juan Pérez", "María García"],
    "placas": ["ABC-123", "XYZ-789"],
    "aseguradoras": [],
    "fechas": ["2026-06-03"],
    "lugares": ["Cra. 7 con Calle 50"]
  },
  "resumen_ejecutivo": "Croquis oficial. Dos vehículos en intersección...",
  "caso_viable": true,
  "analizado_en": "2026-06-03T14:30:00.000Z"
}
```

---

## 🔐 Dependencias Nuevas

| Librería | Versión | Propósito |
|----------|---------|-----------|
| `pdf-parse` | ^2.x | Extracción de texto de PDFs |
| `openai` | ^6.39.0 | Ya existía; usamos GPT-4o |

**Instalación:**
```bash
npm install pdf-parse
```

---

## 📊 Tipos de Documentos Soportados

| Tipo | Descripción | Detección |
|------|-------------|-----------|
| **Croquis** | Diagramas oficiales de accidente | Palabras clave: "croquis", "diagrama", "posición de vehículos" |
| **Cédula** | Documento de identidad | Detección de número cédula, foto, datos personales |
| **Historia Clínica** | Reportes médicos, lesiones | Palabras clave: "diagnóstico", "lesión", "epicrisis", "hospitalización" |
| **Fotos del Accidente** | Evidencia visual de daños | Análisis visual de daños, escenas |
| **Desconocido** | Documento que no encaja | Fallback cuando no hay coincidencia |

---

## 🎯 Casos de Uso Completos

### Caso 1: Usuario envía imagen de cédula

```
1. Usuario: Envía foto de cédula en WhatsApp (estado: documentacion)
2. Bot: Detecta imageMessage
3. Bot: Descarga → ./downloads/lead_42_1717416600000.jpg
4. Bot: Pausa automática
5. IA: Analiza imagen → tipo_documento="Cédula", entidades_clave={...}
6. BD: INSERT INTO lead_documents
7. Telegram: Alerta con número de cédula y detalles detectados
```

### Caso 2: Usuario envía PDF de croquis

```
1. Usuario: Envía croquis en PDF (estado: documentacion)
2. Bot: Detecta documentMessage
3. Bot: Descarga → ./downloads/lead_42_1717416700000.pdf
4. Bot: Pausa automática
5. pdf-parse: Extrae texto del PDF
6. IA: Analiza texto → tipo_documento="Croquis", placas=[...], lugares=[...]
7. BD: INSERT INTO lead_documents
8. Telegram: Alerta con ubicación, placas y resumen
```

### Caso 3: Error en análisis (PDF escaneado sin OCR)

```
1. Usuario: Envía PDF escaneado (sin texto extraíble)
2. Bot: Descarga → ./downloads/
3. Bot: Pausa automática
4. pdf-parse: Extrae ""; aviso en logs
5. IA: Intenta analizar vacío; error
6. messageHandler: Catch del error
7. BD: Documento aún se guarda en lead_documents (file_name presente)
8. Telegram: ⚠️ Alerta de "Error en análisis - Requiere revisión manual"
9. Equipo legal: Revisa manualmente
```

---

## 📈 Flujo de Éxito Esperado

✅ **Documento guardado físicamente**  
✅ **Pausa de bot garantizada**  
✅ **Chat history actualizado**  
✅ **Análisis multimodal completado**  
✅ **Resultados en BD (lead_documents)**  
✅ **Telegram notificado (con análisis o error)**  
✅ **Equipo jurídico tiene toda la información**  

---

## 🛠️ Comandos Útiles para Administración

### Ver documentos de un lead:
```sql
SELECT * FROM lead_documents WHERE lead_id = 42;
```

### Obtener análisis de un documento:
```sql
SELECT 
  id,
  file_name,
  document_type,
  JSON_EXTRACT(ai_summary, '$.resumen_ejecutivo') as resumen,
  JSON_EXTRACT(ai_summary, '$.caso_viable') as viable
FROM lead_documents
WHERE lead_id = 42;
```

### Contar documentos por tipo:
```sql
SELECT document_type, COUNT(*) as cantidad
FROM lead_documents
GROUP BY document_type
ORDER BY cantidad DESC;
```

### Buscar documentos por viabilidad:
```sql
SELECT 
  l.id, l.phone, l.name,
  COUNT(d.id) as total_docs,
  SUM(JSON_EXTRACT(d.ai_summary, '$.caso_viable')) as viables
FROM leads l
LEFT JOIN lead_documents d ON l.id = d.lead_id
GROUP BY l.id
HAVING viables > 0;
```

---

## 🚀 Consideraciones de Producción

1. **Rate Limiting OpenAI:** Cada documento análisis consume tokens. Considerar throttling si hay alto volumen.
2. **Tamaño de PDFs:** `pdf-parse` puede ser lenta con PDFs grandes (>50MB). Validar tamaño antes.
3. **Almacenamiento:** Los archivos se guardan en `./downloads/`. Implementar rotación/archivado después de N días.
4. **Auditoría:** Todos los análisis quedan en `ai_summary` para trazabilidad completa.
5. **Privacidad:** No compartir `ai_summary` públicamente; contiene datos sensibles.

---

## 📝 Próximos Pasos

- [ ] Monitorear logs de OpenAI (tokens usado por documento)
- [ ] Implementar compresión de PDFs antes de procesar
- [ ] Crear dashboard de métricas (documentos procesados/día)
- [ ] Configurar alertas si tasa de error > 10%
- [ ] Documentar tipos de documentos no detectados para mejorar prompts

---

**Fecha de implementación:** 2026-06-03  
**Versión del sistema:** 1.0  
**Estado:** ✅ Listo para producción
