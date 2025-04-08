const { Pool } = require('pg');
require('dotenv').config();

// Подключение к базе данных
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME
});

// Создание таблиц при запуске
async function initDatabase() {
  try {
    await createTables();
    
    // Проверяем, есть ли уже администраторы
    const admins = await getAllAdmins();
    if (admins.length === 0) {
      // Если администраторов нет, добавляем первого из переменной окружения
      const adminChatId = process.env.ADMIN_CHAT_ID;
      if (adminChatId) {
        await addAdmin(adminChatId, 'main_admin', adminChatId);
        console.log('First admin added successfully');
      }
    }
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Получение всех пользователей
async function getAllUsers() {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM users ORDER BY created_at DESC');
    return result.rows;
  } finally {
    client.release();
  }
}

// Добавление нового пользователя
async function addUser(userData) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO users 
      (telegram_id, phone_number, first_name, last_name, passport_number, visa_expiry_date) 
      VALUES ($1, $2, $3, $4, $5, $6) 
      ON CONFLICT (telegram_id) 
      DO UPDATE SET 
        phone_number = $2, 
        first_name = $3, 
        last_name = $4, 
        passport_number = $5, 
        visa_expiry_date = $6
      RETURNING *`,
      [
        userData.telegram_id,
        userData.phone_number,
        userData.first_name,
        userData.last_name,
        userData.passport_number,
        userData.visa_expiry_date
      ]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

// Получение пользователей с истекающими визами
async function getExpiringVisas(daysThreshold = 30) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM users WHERE visa_expiry_date <= CURRENT_DATE + INTERVAL \'1 day\' * $1',
      [daysThreshold]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// Получение пользователей по неделе
async function getUsersByWeek(startDate, endDate) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM users WHERE visa_expiry_date BETWEEN $1 AND $2 ORDER BY visa_expiry_date',
      [startDate, endDate]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// Получение данных пользователя по telegram_id
async function getUserByTelegramId(telegramId) {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    return result.rows[0];
  } finally {
    client.release();
  }
}

// Создание таблиц
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        phone_number VARCHAR(20),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        passport_number VARCHAR(20),
        visa_expiry_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username VARCHAR(100),
        added_by BIGINT,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Tables created successfully');
  } catch (error) {
    console.error('Error creating tables:', error);
    throw error;
  }
}

// Функции для работы с администраторами
async function addAdmin(telegramId, username, addedBy) {
  try {
    const result = await pool.query(
      'INSERT INTO admins (telegram_id, username, added_by) VALUES ($1, $2, $3) RETURNING *',
      [telegramId, username, addedBy]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error adding admin:', error);
    throw error;
  }
}

async function removeAdmin(telegramId) {
  try {
    const result = await pool.query(
      'DELETE FROM admins WHERE telegram_id = $1 RETURNING *',
      [telegramId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error removing admin:', error);
    throw error;
  }
}

async function isAdmin(telegramId) {
  try {
    const result = await pool.query(
      'SELECT * FROM admins WHERE telegram_id = $1',
      [telegramId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking admin status:', error);
    throw error;
  }
}

async function getAllAdmins() {
  try {
    const result = await pool.query('SELECT * FROM admins ORDER BY added_at DESC');
    return result.rows;
  } catch (error) {
    console.error('Error getting all admins:', error);
    throw error;
  }
}

module.exports = {
  initDatabase,
  getAllUsers,
  addUser,
  getExpiringVisas,
  getUsersByWeek,
  getUserByTelegramId,
  addAdmin,
  removeAdmin,
  isAdmin,
  getAllAdmins
}; 