require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const db = require('./db');

// Инициализация бота
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Состояния пользователей для пошагового ввода
const userStates = new Map();

// Функции проверки данных
const validators = {
  phone: (value) => {
    const phoneRegex = /^(\+?998)?\s*(\d{2})\s*(\d{3})\s*(\d{2})\s*(\d{2})$/;
    const cleanPhone = value.replace(/\s+/g, '');
    if (!phoneRegex.test(cleanPhone)) {
      return { isValid: false, message: 'Неверный формат номера телефона. Пожалуйста, введите номер в формате: +998 94 205 25 25 или 94 205 25 25' };
    }
    return { isValid: true, value: cleanPhone.startsWith('+') ? cleanPhone : `+998${cleanPhone}` };
  },
  name: (value) => {
    const nameRegex = /^[А-Яа-яA-Za-z\s-]{2,50}$/;
    if (!nameRegex.test(value)) {
      return { isValid: false, message: 'Имя должно содержать только буквы, пробелы и дефис. Длина от 2 до 50 символов.' };
    }
    return { isValid: true, value: value.trim() };
  },
  passport: (value) => {
    // Универсальный формат паспорта: от 5 до 15 символов, может содержать буквы и цифры
    const passportRegex = /^[A-Za-z0-9]{5,15}$/;
    if (!passportRegex.test(value)) {
      return { isValid: false, message: 'Неверный формат паспорта. Пожалуйста, введите номер паспорта (от 5 до 15 символов, буквы и цифры)' };
    }
    return { isValid: true, value: value.toUpperCase() };
  },
  date: (value) => {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(value)) {
      return { isValid: false, message: 'Неверный формат даты. Пожалуйста, введите в формате: ГГГГ-ММ-ДД' };
    }
    const date = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (isNaN(date.getTime())) {
      return { isValid: false, message: 'Неверная дата. Пожалуйста, введите корректную дату.' };
    }
    
    if (date < today) {
      return { isValid: false, message: 'Дата не может быть в прошлом. Пожалуйста, введите будущую дату.' };
    }
    
    return { isValid: true, value };
  }
};

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  const isAdmin = await db.isAdmin(chatId);
  
  // Сбрасываем состояние пользователя при команде /start
  userStates.delete(chatId);
  
  if (isAdmin) {
    const keyboard = {
      reply_markup: {
        keyboard: [
          ['📊 Получить данные'],
          ['➕ Добавить данные'],
          ['🔍 Проверка сроков'],
          ['👥 Управление админами']
        ],
        resize_keyboard: true
      }
    };
    bot.sendMessage(chatId, 'Добро пожаловать, администратор! Выберите действие:', keyboard);
  } else {
    const keyboard = {
      reply_markup: {
        keyboard: [
          ['📝 Добавить данные'],
          ['👤 Мои данные']
        ],
        resize_keyboard: true
      }
    };
    bot.sendMessage(chatId, 'Добро пожаловать! Выберите действие:', keyboard);
  }
});

// Обработка данных от пользователей
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const isAdmin = await db.isAdmin(chatId);
  
  // Обработка команд пользователя
  if (msg.text === '📝 Добавить данные') {
    userStates.set(chatId, { step: 'phone' });
    const keyboard = {
      reply_markup: {
        keyboard: [[{
          text: '📱 Отправить номер телефона',
          request_contact: true
        }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    };
    bot.sendMessage(chatId, 'Пожалуйста, отправьте свой номер телефона:', keyboard);
    return;
  } else if (msg.text === '👤 Мои данные') {
    try {
      const user = await db.getUserByTelegramId(chatId);
      
      if (!user) {
        bot.sendMessage(chatId, 'У вас пока нет сохраненных данных. Нажмите "📝 Добавить данные" чтобы добавить информацию.');
        return;
      }
      
      const message = `Ваши данные:\n\n` +
        `Телефон: ${user.phone_number}\n` +
        `Имя: ${user.first_name}\n` +
        `Фамилия: ${user.last_name}\n` +
        `Паспорт: ${user.passport_number}\n` +
        `Срок визы: ${formatDisplayDate(user.visa_expiry_date)}\n` +
        `Дата добавления: ${formatDisplayDate(user.created_at)}\n\n` +
        `Чтобы обновить данные, нажмите "📝 Добавить данные"`;
      
      bot.sendMessage(chatId, message);
      return;
    } catch (error) {
      console.error('Error getting user data:', error);
      bot.sendMessage(chatId, 'Произошла ошибка при получении данных. Пожалуйста, попробуйте позже.');
      return;
    }
  }
  
  if (isAdmin) {
    if (msg.text === '📊 Получить данные') {
      handleGetData(chatId);
      return;
    } else if (msg.text === '➕ Добавить данные') {
      userStates.set(chatId, { step: 'admin_phone' });
      bot.sendMessage(chatId, 'Введите номер телефона пользователя:');
      return;
    } else if (msg.text === '🔍 Проверка сроков') {
      checkExpiringVisas(chatId);
      return;
    } else if (msg.text === '👥 Управление админами') {
      handleAdminManagement(chatId);
      return;
    } else if (msg.text === '➕ Добавить админа') {
      userStates.set(chatId, { step: 'add_admin_id' });
      bot.sendMessage(chatId, 'Введите Telegram ID нового администратора:');
      return;
    } else if (msg.text === '❌ Удалить админа') {
      userStates.set(chatId, { step: 'remove_admin_id' });
      bot.sendMessage(chatId, 'Введите Telegram ID администратора для удаления:');
      return;
    } else if (msg.text === '📋 Список админов') {
      handleListAdmins(chatId);
      return;
    } else if (msg.text === '◀️ Назад') {
      const keyboard = {
        reply_markup: {
          keyboard: [
            ['📊 Получить данные'],
            ['➕ Добавить данные'],
            ['🔍 Проверка сроков'],
            ['👥 Управление админами']
          ],
          resize_keyboard: true
        }
      };
      bot.sendMessage(chatId, 'Главное меню:', keyboard);
      return;
    }
  }

  // Обработка состояний пользователя
  const state = userStates.get(chatId);
  if (!state) return;

  // Обработка добавления администратора
  if (state.step === 'add_admin_id') {
    const adminId = parseInt(msg.text);
    if (isNaN(adminId)) {
      bot.sendMessage(chatId, 'Пожалуйста, введите корректный Telegram ID (только цифры)');
      return;
    }
    
    userStates.set(chatId, { 
      step: 'add_admin_username',
      adminId: adminId
    });
    bot.sendMessage(chatId, 'Введите username нового администратора (без @):');
    return;
  }
  
  if (state.step === 'add_admin_username') {
    try {
      await db.addAdmin(state.adminId, msg.text, chatId);
      bot.sendMessage(chatId, `Администратор успешно добавлен!\nID: ${state.adminId}\nUsername: ${msg.text}`);
      userStates.delete(chatId);
      handleAdminManagement(chatId);
    } catch (error) {
      console.error('Error adding admin:', error);
      bot.sendMessage(chatId, 'Произошла ошибка при добавлении администратора. Пожалуйста, попробуйте позже.');
    }
    return;
  }
  
  // Обработка удаления администратора
  if (state.step === 'remove_admin_id') {
    const adminId = parseInt(msg.text);
    if (isNaN(adminId)) {
      bot.sendMessage(chatId, 'Пожалуйста, введите корректный Telegram ID (только цифры)');
      return;
    }
    
    try {
      const removedAdmin = await db.removeAdmin(adminId);
      if (removedAdmin) {
        bot.sendMessage(chatId, `Администратор успешно удален!\nID: ${adminId}`);
      } else {
        bot.sendMessage(chatId, 'Администратор с таким ID не найден.');
      }
      userStates.delete(chatId);
      handleAdminManagement(chatId);
    } catch (error) {
      console.error('Error removing admin:', error);
      bot.sendMessage(chatId, 'Произошла ошибка при удалении администратора. Пожалуйста, попробуйте позже.');
    }
    return;
  }

  // Обработка контакта
  if (msg.contact && state.step === 'phone') {
    state.phone = msg.contact.phone_number;
    state.step = 'firstName';
    bot.sendMessage(chatId, 'Введите имя:');
    return;
  }

  // Обработка ввода данных
  if (isAdmin) {
    // Обработка ввода данных администратором
    switch (state.step) {
      case 'admin_phone':
        const adminPhoneValidation = validators.phone(msg.text);
        if (!adminPhoneValidation.isValid) {
          bot.sendMessage(chatId, adminPhoneValidation.message);
          return;
        }
        state.phone = adminPhoneValidation.value;
        state.step = 'admin_firstName';
        bot.sendMessage(chatId, 'Введите имя пользователя:');
        break;
      case 'admin_firstName':
        const adminFirstNameValidation = validators.name(msg.text);
        if (!adminFirstNameValidation.isValid) {
          bot.sendMessage(chatId, adminFirstNameValidation.message);
          return;
        }
        state.firstName = adminFirstNameValidation.value;
        state.step = 'admin_lastName';
        bot.sendMessage(chatId, 'Введите фамилию пользователя:');
        break;
      case 'admin_lastName':
        const adminLastNameValidation = validators.name(msg.text);
        if (!adminLastNameValidation.isValid) {
          bot.sendMessage(chatId, adminLastNameValidation.message);
          return;
        }
        state.lastName = adminLastNameValidation.value;
        state.step = 'admin_passport';
        bot.sendMessage(chatId, 'Введите номер паспорта (от 5 до 15 символов, буквы и цифры):');
        break;
      case 'admin_passport':
        const adminPassportValidation = validators.passport(msg.text);
        if (!adminPassportValidation.isValid) {
          bot.sendMessage(chatId, adminPassportValidation.message);
          return;
        }
        state.passportSeries = ''; // Убираем разделение на серию и номер
        state.passportNumber = adminPassportValidation.value;
        state.step = 'admin_visaExpiry';
        bot.sendMessage(chatId, 'Введите срок действия визы (ГГГГ-ММ-ДД):');
        break;
      case 'admin_visaExpiry':
        const adminDateValidation = validators.date(msg.text);
        if (!adminDateValidation.isValid) {
          bot.sendMessage(chatId, adminDateValidation.message);
          return;
        }
        try {
          const userData = {
            telegram_id: Date.now(), // Временный telegram_id
            phone_number: state.phone,
            first_name: state.firstName,
            last_name: state.lastName,
            passport_series: state.passportSeries,
            passport_number: state.passportNumber,
            visa_expiry_date: adminDateValidation.value
          };
          
          await db.addUser(userData);
          userStates.delete(chatId);
          
          // Отправляем сообщение об успешном сохранении
          bot.sendMessage(chatId, 'Данные успешно добавлены!');
          
          // Отправляем обновленное меню для администратора
          const adminKeyboard = {
            reply_markup: {
              keyboard: [
                ['📊 Получить данные'],
                ['➕ Добавить данные'],
                ['🔍 Проверка сроков'],
                ['👥 Управление админами']
              ],
              resize_keyboard: true
            }
          };
          bot.sendMessage(chatId, 'Выберите действие:', adminKeyboard);
        } catch (error) {
          console.error('Error adding user data:', error);
          bot.sendMessage(chatId, 'Произошла ошибка при добавлении данных. Пожалуйста, попробуйте еще раз.');
        }
        break;
    }
  } else {
    // Обработка ввода данных пользователем
    switch (state.step) {
      case 'phone':
        const phoneValidation = validators.phone(msg.text);
        if (!phoneValidation.isValid) {
          bot.sendMessage(chatId, phoneValidation.message);
          return;
        }
        state.phone = phoneValidation.value;
        state.step = 'firstName';
        bot.sendMessage(chatId, 'Введите имя:');
        break;
      case 'firstName':
        const firstNameValidation = validators.name(msg.text);
        if (!firstNameValidation.isValid) {
          bot.sendMessage(chatId, firstNameValidation.message);
          return;
        }
        state.firstName = firstNameValidation.value;
        state.step = 'lastName';
        bot.sendMessage(chatId, 'Введите фамилию:');
        break;
      case 'lastName':
        const lastNameValidation = validators.name(msg.text);
        if (!lastNameValidation.isValid) {
          bot.sendMessage(chatId, lastNameValidation.message);
          return;
        }
        state.lastName = lastNameValidation.value;
        state.step = 'passport';
        bot.sendMessage(chatId, 'Введите номер паспорта (от 5 до 15 символов, буквы и цифры):');
        break;
      case 'passport':
        const passportValidation = validators.passport(msg.text);
        if (!passportValidation.isValid) {
          bot.sendMessage(chatId, passportValidation.message);
          return;
        }
        state.passportSeries = ''; // Убираем разделение на серию и номер
        state.passportNumber = passportValidation.value;
        state.step = 'visaExpiry';
        bot.sendMessage(chatId, 'Введите срок действия визы (ГГГГ-ММ-ДД):');
        break;
      case 'visaExpiry':
        const dateValidation = validators.date(msg.text);
        if (!dateValidation.isValid) {
          bot.sendMessage(chatId, dateValidation.message);
          return;
        }
        try {
          const userData = {
            telegram_id: chatId,
            phone_number: state.phone,
            first_name: state.firstName,
            last_name: state.lastName,
            passport_series: state.passportSeries,
            passport_number: state.passportNumber,
            visa_expiry_date: dateValidation.value
          };
          
          await db.addUser(userData);
          userStates.delete(chatId);
          
          // Отправляем сообщение об успешном сохранении
          bot.sendMessage(chatId, 'Данные успешно сохранены!');
          
          // Отправляем обновленное меню
          const keyboard = {
            reply_markup: {
              keyboard: [
                ['📝 Добавить данные'],
                ['👤 Мои данные']
              ],
              resize_keyboard: true
            }
          };
          bot.sendMessage(chatId, 'Выберите действие:', keyboard);
        } catch (error) {
          console.error('Error saving user data:', error);
          bot.sendMessage(chatId, 'Произошла ошибка при сохранении данных. Пожалуйста, попробуйте еще раз.');
        }
        break;
    }
  }
});

// Функция получения данных для администратора
async function handleGetData(chatId) {
  try {
    const users = await db.getAllUsers();
    
    if (users.length === 0) {
      bot.sendMessage(chatId, 'Нет данных пользователей');
      return;
    }
    
    // Группировка данных по неделям
    const groupedByWeek = groupVisasByWeek(users);
    
    // Создаем клавиатуру с неделями и опцией "Все данные"
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Все данные', callback_data: 'all_data' }],
          ...Object.keys(groupedByWeek).map(week => [{
            text: week,
            callback_data: `week_${week}`
          }])
        ]
      }
    };
    
    bot.sendMessage(chatId, 'Выберите неделю для просмотра виз или все данные:', keyboard);
    
    // Сохраняем данные для использования в callback
    userStates.set(chatId, { 
      step: 'view_weeks',
      visaData: groupedByWeek,
      allData: users
    });
  } catch (error) {
    console.error('Error getting user data:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при получении данных');
  }
}

// Функция группировки виз по неделям
function groupVisasByWeek(users) {
  const grouped = {};
  
  users.forEach(user => {
    const expiryDate = new Date(user.visa_expiry_date);
    const weekStart = getWeekStart(expiryDate);
    const weekEnd = getWeekEnd(expiryDate);
    const weekKey = `${formatDate(weekStart)} - ${formatDate(weekEnd)}`;
    
    if (!grouped[weekKey]) {
      grouped[weekKey] = [];
    }
    
    grouped[weekKey].push(user);
  });
  
  return grouped;
}

// Функция получения начала недели
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

// Функция получения конца недели
function getWeekEnd(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 0 : 7);
  return new Date(d.setDate(diff));
}

// Функция форматирования даты
function formatDate(date) {
  const d = new Date(date);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

// Функция форматирования даты для отображения
function formatDisplayDate(date) {
  const d = new Date(date);
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Обработка callback-запросов
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  
  if (data === 'all_data') {
    const userState = userStates.get(chatId);
    
    if (userState && userState.allData) {
      const users = userState.allData;
      
      if (users.length === 0) {
        bot.sendMessage(chatId, 'Нет данных пользователей');
        return;
      }
      

      
      const message = `👥Все данные пользователей:\n\n` +
        users.map(user => 
          `Телефон: ${user.phone_number}\n` +
          `Имя: ${user.first_name}\n` +
          `Фамилия: ${user.last_name}\n` +
          `Паспорт: ${user.passport_number}\n` +
          `Срок визы: ${formatDisplayDate(user.visa_expiry_date)}\n` +
          `Дата добавления: ${formatDisplayDate(user.created_at)}\n`
        ).join('\n');
      
      bot.sendMessage(chatId, message);
    } else {
      bot.sendMessage(chatId, 'Данные не найдены. Пожалуйста, запросите данные снова.');
    }
  } else if (data.startsWith('week_')) {
    const weekKey = data.replace('week_', '');
    const userState = userStates.get(chatId);
    
    if (userState && userState.visaData && userState.visaData[weekKey]) {
      const users = userState.visaData[weekKey];
      
      if (users.length === 0) {
        bot.sendMessage(chatId, `На неделю ${weekKey} нет виз, которые истекают.`);
        return;
      }
      
      const message = `Визы, истекающие на неделе ${weekKey}:\n\n` +
        users.map(user => 
          `Телефон: ${user.phone_number}\n` +
          `Имя: ${user.first_name}\n` +
          `Фамилия: ${user.last_name}\n` +
          `Паспорт: ${user.passport_number}\n` +
          `Срок визы: ${formatDisplayDate(user.visa_expiry_date)}\n`
        ).join('\n');
      
      bot.sendMessage(chatId, message);
    } else {
      bot.sendMessage(chatId, 'Данные не найдены. Пожалуйста, запросите данные снова.');
    }
  }
  
  // Отвечаем на callback, чтобы убрать "часики" у кнопки
  bot.answerCallbackQuery(query.id);
});

// Проверка сроков виз каждый день в 9:00
cron.schedule('0 9 * * *', async () => {
  try {
    const expiringVisas = await db.getExpiringVisas(3); // Изменено на 3 дня
    
    if (expiringVisas.length > 0) {
      const message = expiringVisas.map(user => 
        `⌛️Внимание! Истекает виза пользователя:\n` +
        `Телефон: ${user.phone_number}\n` +
        `Имя: ${user.first_name}\n` +
        `Фамилия: ${user.last_name}\n` +
        `Паспорт: ${user.passport_number}\n` +
        `Истекает: ${formatDisplayDate(user.visa_expiry_date)}`
      ).join('\n\n');
      
      bot.sendMessage(process.env.ADMIN_CHAT_ID, message);
    }
  } catch (error) {
    console.error('Error checking visa expiration:', error);
  }
}, {
  timezone: 'Asia/Tashkent'
});

// Функция проверки сроков виз на ближайшие 7 дней
async function checkExpiringVisas(chatId) {
  try {
    const expiringVisas = await db.getExpiringVisas(7);
    
    if (expiringVisas.length === 0) {
      bot.sendMessage(chatId, 'На ближайшие 7 дней нет виз, которые истекают.');
      return;
    }
    
    const message = `📨 Визы, истекающие в ближайшие 7 дней:\n\n` +
      expiringVisas.map(user => 
        `Телефон: ${user.phone_number}\n` +
        `Имя: ${user.first_name}\n` +
        `Фамилия: ${user.last_name}\n` +
        `Паспорт: ${user.passport_number}\n` +
        `Истекает: ${formatDisplayDate(user.visa_expiry_date)}\n`
      ).join('\n');
    
    bot.sendMessage(chatId, message);
  } catch (error) {
    console.error('Error checking expiring visas:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при проверке сроков виз. Пожалуйста, попробуйте позже.');
  }
}

// Функция управления администраторами
async function handleAdminManagement(chatId) {
  const keyboard = {
    reply_markup: {
      keyboard: [
        ['➕ Добавить админа'],
        ['❌ Удалить админа'],
        ['📋 Список админов'],
        ['◀️ Назад']
      ],
      resize_keyboard: true
    }
  };
  bot.sendMessage(chatId, 'Выберите действие:', keyboard);
}

// Показ списка администраторов
async function handleListAdmins(chatId) {
  try {
    const admins = await db.getAllAdmins();
    if (admins.length === 0) {
      bot.sendMessage(chatId, 'Список администраторов пуст.');
      return;
    }
    
    const message = 'Список администраторов:\n\n' +
      admins.map(admin => 
        `ID: ${admin.telegram_id}\n` +
        `Username: ${admin.username}\n` +
        `Добавлен: ${formatDisplayDate(admin.added_at)}\n`
      ).join('\n');
    
    bot.sendMessage(chatId, message);
  } catch (error) {
    console.error('Error listing admins:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при получении списка администраторов. Пожалуйста, попробуйте позже.');
  }
}

// Инициализация базы данных при запуске
db.initDatabase().catch(console.error);

console.log('Bot started');