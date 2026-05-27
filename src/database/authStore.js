import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import { pool } from './connection.js';

export async function useMySQLAuthState(sessionId) {
    // Función interna para escribir datos en la base de datos
    const writeData = async (data, id) => {
        const jsonStr = JSON.stringify(data, BufferJSON.replacer);
        await pool.query(
            'INSERT INTO whatsapp_sessions (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?',
            [id, jsonStr, jsonStr]
        );
    };

    // Función interna para leer datos desde la base de datos
    const readData = async (id) => {
        try {
            const [rows] = await pool.query('SELECT data FROM whatsapp_sessions WHERE id = ?', [id]);
            if (rows.length === 0) return null;
            return JSON.parse(rows[0].data, BufferJSON.reviver);
        } catch (error) {
            return null;
        }
    };

    // Función interna para borrar datos de sesión si es necesario
    const removeData = async (id) => {
        await pool.query('DELETE FROM whatsapp_sessions WHERE id = ?', [id]);
    };

    // Intentamos recuperar las credenciales básicas de la sesión
    let creds = await readData(`${sessionId}:creds`);
    if (!creds) {
        creds = initAuthCreds();
        await writeData(creds, `${sessionId}:creds`);
    }

    return {
        state: {
            creds,
            // Las llaves criptográficas secundarias que usa WhatsApp Web para cifrar mensajes
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        let value = await readData(`${sessionId}:${type}:${id}`);
                        if (value) {
                            if (type === 'app-state-sync-key') {
                                value = value;
                            }
                            data[id] = value;
                        }
                    }
                    return data;
                },
                set: async (data) => {
                    for (const type in data) {
                        for (const id in data[type]) {
                            const value = data[type][id];
                            const key = `${sessionId}:${type}:${id}`;
                            if (value === null) {
                                await removeData(key);
                            } else {
                                await writeData(value, key);
                            }
                        }
                    }
                }
            }
        },
        saveCreds: async () => {
            await writeData(creds, `${sessionId}:creds`);
        }
    };
}