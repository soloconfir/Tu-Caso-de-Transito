import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Creamos un grupo de conexiones (Pool) para manejar peticiones simultáneas de forma eficiente
export const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Función rápida para verificar que la base de datos responde
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Conexión con MySQL establecida con éxito.');
        connection.release();
    } catch (error) {
        console.error('❌ Error crítico al conectar con MySQL:', error.message);
    }
}

testConnection();