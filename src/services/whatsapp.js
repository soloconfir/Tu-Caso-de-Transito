import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal'; // 👈 1. Nueva importación
import { useMySQLAuthState } from '../database/authStore.js';
import { manejarMensajeEntrante } from './messageHandler.js';

export async function iniciarAgenteWhatsApp() {
    const sessionId = 'sesion_principal_agente';
    const { state, saveCreds } = await useMySQLAuthState(sessionId);

    console.log('🤖 Inicializando el socket del Agente de WhatsApp...');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // 👈 2. Lo ponemos en false porque ahora lo pintaremos a mano
        logger: pino({ level: 'silent' }),
        browser: ['Agente Automático', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📷 Código QR generado. Escanéalo con tu WhatsApp (Dispositivos vinculados):\n');
            // 👈 3. Esto fuerza a la consola de Codespaces a dibujar el QR de forma compacta y legible
            qrcode.generate(qr, { small: true }); 
        }

        if (connection === 'close') {
            const debeReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Conexión cerrada debido a: ${lastDisconnect?.error?.message || 'Error desconocido'}.`);
            
            if (debeReconectar) {
                console.log('🔄 Intentando reconectar de inmediato...');
                iniciarAgenteWhatsApp();
            } else {
                console.log('❌ Sesión cerrada por el usuario.');
            }
        } else if (connection === 'open') {
            console.log('✅ ¡Agente de WhatsApp conectado con éxito y listo para procesar leads!');
        }
    });
    // Escuchamos cuando llegan nuevos mensajes
sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
        for (const msg of m.messages) {
            await manejarMensajeEntrante(sock, msg);
        }
    }
});
    sock.ev.on('creds.update', saveCreds);

    return sock;
}