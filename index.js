import { iniciarAgenteWhatsApp } from './src/services/whatsapp.js';

async function main() {
    try {
        console.log('🚀 Arrancando el Sistema del Agente Conversacional...');
        await iniciarAgenteWhatsApp();
    } catch (error) {
        console.error('❌ Error fatal al iniciar el sistema:', error);
    }
}

main();