import TelegramBot from "node-telegram-bot-api"
import { loginUser, getYears, getTerms, getGrades, getDiary } from "./api.js"
import dotenv from "dotenv"
dotenv.config()

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true })

// Хранилище сессий пользователей (в памяти)
const sessions = {}

const CITIES = [
  { code: "alm", name: "Алматы ФМН" },
  { code: "hbalm", name: "Алматы ХБН (Наурызбай)" },
  { code: "mdalm", name: "Алматы ФМН (Медеу)" },
  { code: "ast", name: "Астана ФМН" },
  { code: "hbast", name: "Астана ХБН" },
  { code: "ibast", name: "Астана IB" },
  { code: "shym", name: "Шымкент ФМН" },
  { code: "hbshym", name: "Шымкент ХБН" },
  { code: "akb", name: "Актобе" },
  { code: "krg", name: "Караганда" },
  { code: "pvl", name: "Павлодар" },
  { code: "trz", name: "Тараз" },
  { code: "ura", name: "Уральск" },
  { code: "atr", name: "Атырау" },
  { code: "akt", name: "Актау" },
  { code: "kst", name: "Костанай" },
  { code: "ptr", name: "Петропавловск" },
  { code: "sm", name: "Семей" },
  { code: "tlk", name: "Талдыкорган" },
  { code: "kksh", name: "Кокшетау" },
  { code: "trk", name: "Туркестан" },
  { code: "kzl", name: "Кызылорда" },
  { code: "ukk", name: "Усть-Каменогорск" },
]

function getSession(chatId) {
  if (!sessions[chatId]) {
    sessions[chatId] = { step: "idle", data: {} }
  }
  return sessions[chatId]
}

function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "📊 Оценки за год" }, { text: "📓 Дневник" }],
        [{ text: "👤 Профиль" }, { text: "🚪 Выйти" }],
      ],
      resize_keyboard: true,
    },
  }
}

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id
  const session = getSession(chatId)
  session.step = "idle"
  session.data = {}

  if (session.token) {
    await bot.sendMessage(chatId, "👋 Ты уже вошёл! Выбери действие:", mainMenu())
  } else {
    await bot.sendMessage(
      chatId,
      "👋 Привет! Это неофициальный клиент электронного дневника НИС.\n\nВведи команду /login чтобы войти."
    )
  }
})

// /login
bot.onText(/\/login/, async (msg) => {
  const chatId = msg.chat.id
  const session = getSession(chatId)
  session.step = "choose_city"
  session.data = {}

  const buttons = CITIES.map((c) => [{ text: c.name, callback_data: `city_${c.code}` }])
  const chunks = []
  for (let i = 0; i < buttons.length; i += 2) {
    chunks.push(buttons.slice(i, i + 2).flat())
  }

  await bot.sendMessage(chatId, "🏙 Выбери свой город:", {
    reply_markup: { inline_keyboard: chunks },
  })
})

// Обработка callback кнопок
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id
  const session = getSession(chatId)
  const data = query.data

  await bot.answerCallbackQuery(query.id)

  // Выбор города
  if (data.startsWith("city_")) {
    const city = data.replace("city_", "")
    session.data.city = city
    session.step = "enter_login"
    await bot.sendMessage(chatId, "📝 Введи свой логин (12 цифр, ИИН):")
    return
  }

  // Выбор года
  if (data.startsWith("year_")) {
    const yearId = data.replace("year_", "")
    session.data.yearId = yearId
    await showTerms(chatId, session)
    return
  }

  // Выбор четверти для дневника
  if (data.startsWith("diary_term_")) {
    const termId = data.replace("diary_term_", "")
    await showDiary(chatId, session, termId)
    return
  }

  // Выбор года для оценок
  if (data.startsWith("grades_year_")) {
    const yearId = data.replace("grades_year_", "")
    await showGrades(chatId, session, yearId)
    return
  }
})

// Обработка текстовых сообщений
bot.on("message", async (msg) => {
  const chatId = msg.chat.id
  const text = msg.text
  const session = getSession(chatId)

  if (!text || text.startsWith("/")) return

  // Главное меню
  if (session.token) {
    if (text === "📊 Оценки за год") {
      await startGrades(chatId, session)
      return
    }
    if (text === "📓 Дневник") {
      await startDiary(chatId, session)
      return
    }
    if (text === "👤 Профиль") {
      await showProfile(chatId, session)
      return
    }
    if (text === "🚪 Выйти") {
      delete sessions[chatId]
      await bot.sendMessage(chatId, "👋 Ты вышел из аккаунта. Введи /login чтобы войти снова.", {
        reply_markup: { remove_keyboard: true },
      })
      return
    }
  }

  // Шаги авторизации
  if (session.step === "enter_login") {
    if (!/^\d{12}$/.test(text)) {
      await bot.sendMessage(chatId, "❌ Логин должен состоять из 12 цифр. Попробуй ещё раз:")
      return
    }
    session.data.login = text
    session.step = "enter_password"
    await bot.sendMessage(chatId, "🔑 Введи пароль:")
    return
  }

  if (session.step === "enter_password") {
    session.data.password = text
    session.step = "logging_in"
    await doLogin(chatId, session)
    return
  }
})

async function doLogin(chatId, session) {
  try {
    await bot.sendMessage(chatId, "⏳ Выполняю вход...")
    const result = await loginUser({
      city: session.data.city,
      login: session.data.login,
      password: session.data.password,
    })
    session.token = result.token
    session.step = "idle"
    await bot.sendMessage(chatId, "✅ Вход выполнен! Выбери действие:", mainMenu())
  } catch (e) {
    console.error("Login error:", e.message)
    await bot.sendMessage(chatId, `❌ Ошибка входа: ${e.message}

Проверь логин и пароль и попробуй /login ещё раз.`)
    session.step = "idle"
  }
}


async function startGrades(chatId, session) {
  try {
    await bot.sendMessage(chatId, "⏳ Загружаю учебные годы...")
    const years = await getYears(session.token, session.data.city)
    session.token = years.newToken || session.token

    const buttons = years.data.map((y) => [
      { text: y.Name + (y.isActual ? " ✅" : ""), callback_data: `grades_year_${y.Id}` },
    ])
    await bot.sendMessage(chatId, "📅 Выбери учебный год:", {
      reply_markup: { inline_keyboard: buttons },
    })
  } catch (e) {
    await handleError(chatId, session, e)
  }
}

async function showGrades(chatId, session, yearId) {
  try {
    await bot.sendMessage(chatId, "⏳ Загружаю оценки...")
    const result = await getGrades(session.token, session.data.city, yearId)
    session.token = result.newToken || session.token

    if (!result.data.length) {
      await bot.sendMessage(chatId, "📭 Оценок пока нет.", mainMenu())
      return
    }

    const GRADE_MAP = {
      FirstPeriod: "1 чет",
      SecondPeriod: "2 чет",
      FirstHalfYear: "1 пол",
      ThirdPeriod: "3 чет",
      ForthPeriod: "4 чет",
      SecondHalfYear: "2 пол",
      Exam: "Экз",
      Year: "Год",
      Final: "Итог",
    }

    let text = "📊 *Оценки за год:*\n\n"
    for (const subject of result.data) {
      text += `*${subject.SubjectName}*\n`
      const parts = []
      for (const [key, label] of Object.entries(GRADE_MAP)) {
        if (subject[key]) parts.push(`${label}: ${subject[key]}`)
      }
      text += parts.join(" | ") + "\n\n"
    }

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...mainMenu() })
  } catch (e) {
    await handleError(chatId, session, e)
  }
}

async function startDiary(chatId, session) {
  try {
    await bot.sendMessage(chatId, "⏳ Загружаю учебные годы...")
    const years = await getYears(session.token, session.data.city)
    session.token = years.newToken || session.token

    const actualYear = years.data.find((y) => y.isActual) || years.data[0]
    session.data.yearId = actualYear.Id

    await showTerms(chatId, session)
  } catch (e) {
    await handleError(chatId, session, e)
  }
}

async function showTerms(chatId, session) {
  try {
    await bot.sendMessage(chatId, "⏳ Загружаю четверти...")
    const result = await getTerms(session.token, session.data.city, session.data.yearId)
    session.token = result.newToken || session.token

    const buttons = result.data.map((t) => [
      { text: t.Name + (t.isActual ? " ✅" : ""), callback_data: `diary_term_${t.Id}` },
    ])
    await bot.sendMessage(chatId, "📅 Выбери четверть:", {
      reply_markup: { inline_keyboard: buttons },
    })
  } catch (e) {
    await handleError(chatId, session, e)
  }
}

async function showDiary(chatId, session, termId) {
  try {
    await bot.sendMessage(chatId, "⏳ Загружаю дневник...")
    const result = await getDiary(session.token, session.data.city, termId)
    session.token = result.newToken || session.token

    if (!result.data.length) {
      await bot.sendMessage(chatId, "📭 Данных пока нет.", mainMenu())
      return
    }

    let text = "📓 *Дневник:*\n\n"
    for (const subject of result.data) {
      text += `*${subject.Name}*\n`
      if (subject.Score !== undefined) text += `Баллы: ${subject.Score}`
      if (subject.Mark !== undefined) text += ` | Оценка: ${subject.Mark}`
      text += "\n\n"
    }

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...mainMenu() })
  } catch (e) {
    await handleError(chatId, session, e)
  }
}

async function showProfile(chatId, session) {
  const city = CITIES.find((c) => c.code === session.data.city)
  await bot.sendMessage(
    chatId,
    `👤 *Профиль*\n\nГород: ${city?.name || session.data.city}\nСтатус: Авторизован ✅`,
    { parse_mode: "Markdown", ...mainMenu() }
  )
}

async function handleError(chatId, session, error) {
  if (error.code === 401 || error.message?.includes("Сессия") || error.message?.includes("завершен")) {
    session.token = null
    session.step = "idle"
    await bot.sendMessage(
      chatId,
      "⚠️ Сессия истекла. Нужно войти снова.\n\nВведи /login",
      { reply_markup: { remove_keyboard: true } }
    )
  } else {
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`, mainMenu())
  }
}

console.log("🤖 Бот запущен!")
