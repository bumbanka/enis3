import TelegramBot from "node-telegram-bot-api"
import { getYears, getTerms, getGrades, getDiary, getSubjectDetail, getSchedule, createTokenFromCookies, setUserAgent } from "./api.js"
import dotenv from "dotenv"
dotenv.config()
import "./server.js"

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
        [{ text: "📓 Дневник" }, { text: "📅 Расписание" }],
        [{ text: "📊 Средний балл" }],
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
  session.step = "idle"
  session.data = {}

  const webUrl = process.env.WEB_URL || `http://localhost:${process.env.WEB_PORT || 3000}`
  const loginUrl = `${webUrl}/login?user=${chatId}`

  await bot.sendMessage(chatId,
    `🌐 Для входа открой эту ссылку в браузере:\n\n${loginUrl}\n\nВведи логин и пароль от НИС — бот автоматически получит нужные данные.`,
    { reply_markup: { remove_keyboard: true } }
  )
})

// /setcookies — ручной вход через куки браузера
bot.onText(/\/setcookies (.+)/, async (msg, match) => {
  const chatId = msg.chat.id
  const session = getSession(chatId)
  const cookieStr = match[1].trim()

  const hasAuth = cookieStr.includes("ApplicationAuth") || cookieStr.includes(".ASPXAUTH") || cookieStr.includes("SessionID")
  if (!hasAuth) {
    await bot.sendMessage(chatId, "❌ Куки не содержат токен авторизации. Убедись что скопировал все куки после входа.")
    return
  }

  // Определяем город из session или просим выбрать
  if (!session.data.city) {
    session.data.pendingCookies = cookieStr
    session.step = "choose_city_for_cookies"
    const buttons = CITIES.map((c) => [{ text: c.name, callback_data: `cookies_city_${c.code}` }])
    const chunks = []
    for (let i = 0; i < buttons.length; i += 2) chunks.push(buttons.slice(i, i + 2).flat())
    await bot.sendMessage(chatId, "🏙 Выбери свой город:", { reply_markup: { inline_keyboard: chunks } })
    return
  }

  await saveCookies(chatId, session, cookieStr)
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
    session.step = "waiting_cookies"
    const baseUrl = `https://sms.${city}.nis.edu.kz`
    await bot.sendMessage(chatId,
      `✅ Город выбран!

` +
      `НИС требует капчу для входа через бота, поэтому нужно передать куки из браузера.

` +
      `Как это сделать (один раз):

` +
      `1. Открой в браузере:
${baseUrl}/root/Account/Login

` +
      `2. Войди со своим логином и паролем

` +
      `3. После входа открой F12, вкладка Application, затем Cookies, выбери сайт

` +
      `4. Найди куки ApplicationAuth, Uralsk_SessionID, UserSessionKey, sessionid2 и скопируй их значения в формате:
Название=Значение; Название2=Значение2

` +
      `5. Отправь боту:
/setcookies ApplicationAuth=XXX; Uralsk_SessionID=YYY; UserSessionKey=ZZZ

` +
      `Куки действуют несколько дней, потом нужно повторить.

Также отправь свой User-Agent браузера командой:
/setuseragent ВАШ_USER_AGENT

Чтобы узнать User-Agent открой в браузере: https://www.whatismybrowser.com/detect/what-is-my-user-agent/ и скопируй строку`
    )
    return
  }

  // Выбор города для setcookies
  if (data.startsWith("cookies_city_")) {
    const city = data.replace("cookies_city_", "")
    session.data.city = city
    const cookieStr = session.data.pendingCookies
    session.data.pendingCookies = null
    await saveCookies(chatId, session, cookieStr)
    return
  }

  // Выбор недели расписания
  if (data.startsWith("week_")) {
    const weekDate = data.replace("week_", "")
    await showSchedule(chatId, session, weekDate)
    return
  }

  // Подробнее по предмету
  if (data.startsWith("detail_")) {
    const journalId = data.replace("detail_", "")
    const subject = session.data.diarySubjects?.find(s => s.JournalId === journalId)
    if (!subject) {
      await bot.sendMessage(chatId, "❌ Предмет не найден. Обнови дневник.")
      return
    }
    await showSubjectDetail(chatId, session, subject)
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
    if (text === "📊 Средний балл") {
      await showAverage(chatId, session)
      return
    }
    if (text === "📅 Расписание") {
      await startSchedule(chatId, session)
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



})


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

    let text = "📊 *Оценки за четверть:*\n\n"
    for (const subject of result.data) {
      const name = subject.Name || subject.SubjectName || "Предмет"
      const parts = []
      if (subject.Score !== undefined && subject.Score !== null) parts.push(`Баллы: ${subject.Score}`)
      if (subject.Mark !== undefined && subject.Mark !== null) parts.push(`Оценка: ${subject.Mark}`)
      text += `*${name}*\n${parts.length ? parts.join(" | ") : "Нет оценок"}\n\n`
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

    // Сохраняем для кнопок
    session.data.diarySubjects = result.data

    let text = "📓 *Дневник:*\n\n"
    const buttons = []
    for (const subject of result.data) {
      text += `*${subject.Name}*\n`
      if (subject.Score !== null && subject.Score !== undefined) {
        text += `Итог: ${subject.Score} (оценка: ${subject.Mark})\n`
      }
      text += "\n"
      if (subject.Evaluations?.length) {
        buttons.push([{ text: `🔍 ${subject.Name}`, callback_data: `detail_${subject.JournalId}` }])
      }
    }

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...mainMenu() })
    if (buttons.length) {
      await bot.sendMessage(chatId, "Подробнее по предмету:", {
        reply_markup: { inline_keyboard: buttons }
      })
    }
  } catch (e) {
    await handleError(chatId, session, e)
  }
}

async function showSubjectDetail(chatId, session, subject) {
  try {
    await bot.sendMessage(chatId, `⏳ Загружаю детали по "${subject.Name}"...`)
    const result = await getSubjectDetail(session.token, session.data.city, subject.JournalId, subject.Evaluations)
    session.token = result.newToken || session.token

    let text = `📚 *${subject.Name}*\n`
    if (subject.Score !== null && subject.Score !== undefined) {
      text += `Итог: ${subject.Score} (оценка: ${subject.Mark})\n`
    }
    text += "\n"

    for (const evGroup of result.data) {
      if (!evGroup?.length) continue
      const first = evGroup[0]
      const typeName = first?.ShortName || "СОР/СОЧ"
      text += `*${typeName}:*\n`
      for (const item of evGroup) {
        const score = item.Score !== null && item.Score !== undefined ? item.Score : "—"
        const max = item.MaxScore ? `/${item.MaxScore}` : ""
        text += `  ${item.Name || "Задание"}: ${score}${max}\n`
      }
      text += "\n"
    }

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" })
  } catch (e) {
    await handleError(chatId, session, e)
  }
}


async function startSchedule(chatId, session) {
  try {
    await bot.sendMessage(chatId, "⏳ Загружаю расписание...")
    const years = await getYears(session.token, session.data.city)
    session.token = years.newToken || session.token
    const actualYear = years.data.find(y => y.isActual) || years.data[0]
    session.data.yearId = actualYear.Id

    const today = new Date().toISOString().split("T")[0] + "T00:00:00"
    const result = await getSchedule(session.token, session.data.city, actualYear.Id, today)
    session.token = result.newToken || session.token
    session.data.scheduleWeeks = result.weeks

    await showScheduleData(chatId, session, result.schedule, today)
  } catch (e) {
    await handleError(chatId, session, e)
  }
}

async function showSchedule(chatId, session, weekDate) {
  try {
    await bot.sendMessage(chatId, "⏳ Загружаю расписание...")
    const result = await getSchedule(session.token, session.data.city, session.data.yearId, weekDate)
    session.token = result.newToken || session.token
    await showScheduleData(chatId, session, result.schedule, weekDate)
  } catch (e) {
    await handleError(chatId, session, e)
  }
}

async function showScheduleData(chatId, session, schedule, currentWeek) {
  if (!schedule.length) {
    await bot.sendMessage(chatId, "📭 Расписание пока нет.", mainMenu())
    return
  }

  const DAY_NAMES = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб" }
  const allDays = [1, 2, 3, 4, 5]

  // Определяем рабочие дни из первого урока
  const notWorking = schedule[0]?.NotWorkingDays || []
  const workingDays = allDays.filter(d => !notWorking.includes(d))

  let text = "📅 *Расписание:*\n\n"
  for (const day of workingDays) {
    text += `*${DAY_NAMES[day]}*\n`
    for (const lesson of schedule) {
      const records = lesson[`${day}_Records`]
      if (!records?.length) continue
      const r = records[0]
      const cabinet = r.CabinetName ? ` (${r.CabinetName})` : ""
      text += `  ${lesson.LessonNumber}. ${r.SubjectName}${cabinet}\n`
    }
    text += "\n"
  }

  // Кнопки выбора недели
  const weeks = session.data.scheduleWeeks || []
  const buttons = weeks.slice(0, 5).map(w => ([{
    text: (w.value === currentWeek ? "✅ " : "") + w.name,
    callback_data: `week_${w.value}`
  }]))

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...mainMenu() })
  if (buttons.length) {
    await bot.sendMessage(chatId, "Выбери неделю:", { reply_markup: { inline_keyboard: buttons } })
  }
}

async function showAverage(chatId, session) {
  const subjects = session.data.diarySubjects
  if (!subjects?.length) {
    await bot.sendMessage(chatId, "❌ Сначала открой Дневник чтобы загрузить оценки.", mainMenu())
    return
  }

  const withScores = subjects.filter(s => s.Score !== null && s.Score !== undefined)
  if (!withScores.length) {
    await bot.sendMessage(chatId, "📭 Нет данных об оценках.", mainMenu())
    return
  }

  const avg = withScores.reduce((sum, s) => sum + s.Score, 0) / withScores.length
  const avgMark = withScores.reduce((sum, s) => sum + s.Mark, 0) / withScores.length

  // Сортируем по баллам
  const sorted = [...withScores].sort((a, b) => b.Score - a.Score)
  const best = sorted.slice(0, 3)
  const worst = sorted.slice(-3).reverse()

  let text = `📊 *Средний балл:*\n\n`
  text += `Средний балл: *${avg.toFixed(2)}*\n`
  text += `Средняя оценка: *${avgMark.toFixed(1)}*\n\n`
  text += `🏆 *Лучшие предметы:*\n`
  for (const s of best) text += `  ${s.Name}: ${s.Score} (${s.Mark})\n`
  text += `\n📉 *Слабые предметы:*\n`
  for (const s of worst) text += `  ${s.Name}: ${s.Score} (${s.Mark})\n`

  await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...mainMenu() })
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

bot.onText(/\/setuseragent (.+)/, async (msg, match) => {
  const chatId = msg.chat.id
  const ua = match[1].trim()
  setUserAgent(ua)
  await bot.sendMessage(chatId, "✅ User-Agent обновлён!")
})

console.log("🤖 Бот запущен!")

async function saveCookies(chatId, session, cookieStr) {
  try {
    const token = await createTokenFromCookies(cookieStr, session.data.city)
    session.token = token
    session.step = "idle"
    await bot.sendMessage(chatId, "✅ Куки сохранены! Выбери действие:", mainMenu())
  } catch (e) {
    await bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`)
  }
}
