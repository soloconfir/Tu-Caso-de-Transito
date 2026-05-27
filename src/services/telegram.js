import dotenv from 'dotenv';
dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Envia una alerta estructurada al canal de Telegram del equipo comercial
 * @param {string} mensaje - Contenido en formato Markdown V2 o texto plano
 */
export async function enviarAlertaTelegram(mensaje) {
    if (!TELEGRAM_TOKEN || !CHAT_ID) {
        console.error('⚠️ Alerta de Telegram omitida: Faltan credenciales en el .env');
        return;
    }

    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: mensaje,
                parse_mode: 'HTML' // Usamos HTML para estructurar negritas y listas de forma más sencilla que Markdown
            })
        });

        const data = await response.json();
        if (!data.ok) {
            console.error('❌ Error de respuesta de Telegram API:', data.description);
        } else {
            console.log('🚀 Alerta de nuevo Lead calificado enviada con éxito a Telegram.');
        }
    } catch (error) {
        console.error('❌ Error crítico al conectar con la API de Telegram:', error);
    }
}