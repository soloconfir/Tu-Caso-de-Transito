-- 1. Tabla para la sesión de Baileys
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id VARCHAR(255) PRIMARY KEY,
    data LONGTEXT NOT NULL
);

-- 2. Tabla para los Leads (Con los 3 estados del Agente)
CREATE TABLE IF NOT EXISTS leads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(30) UNIQUE NOT NULL,
    name VARCHAR(100) NULL,
    status ENUM('filtrado', 'documentacion', 'remitido') DEFAULT 'filtrado',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. Tabla para el Historial de Chats (Soporta texto, imágenes y documentos)
CREATE TABLE IF NOT EXISTS chat_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lead_id INT NOT NULL,
    sender ENUM('bot', 'user') NOT NULL,
    message_type ENUM('text', 'image', 'document', 'audio') DEFAULT 'text',
    message TEXT NULL,
    file_path VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- 4. Tabla para los Documentos Extraídos (Para la Etapa 2 de validación)
CREATE TABLE IF NOT EXISTS lead_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lead_id INT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    document_type VARCHAR(100) NULL,
    ai_summary TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- 5. Tabla para la Cola de Mensajes (Cola saliente segura anti-baneo)
CREATE TABLE IF NOT EXISTS message_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lead_id INT NOT NULL,
    message TEXT NOT NULL,
    status ENUM('pendiente', 'enviado', 'fallido') DEFAULT 'pendiente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);