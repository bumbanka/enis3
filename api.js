import fetch from "node-fetch"
import { URLSearchParams } from "url"
import jwt from "jsonwebtoken"
import dotenv from "dotenv"
dotenv.config()

const FAKE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"

let SESSION_USER_AGENT = FAKE_USER_AGENT

function cookieParse(res) {
  const rawCookies = res.headers.raw()["set-cookie"]
  if (!rawCookies) return null
  return rawCookies.map((cookie) => cookie.split(";")[0]).join("; ")
}

function stringToObject(cookieString) {
  if (!cookieString) return {}
  const result = {}
  cookieString.split("; ").filter((c) => c.length).forEach((c) => {
    const idx = c.indexOf("=")
    if (idx === -1) return
    const key = c.slice(0, idx)
    const val = c.slice(idx + 1)
    result[key] = val
  })
  return result
}

function mergeCookies(oldCookie, newCookie) {
  if (!newCookie) return oldCookie || ""
  if (!oldCookie) return newCookie
  return Object.entries(
    Object.assign(stringToObject(oldCookie), stringToObject(newCookie))
  )
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

function decodeToken(token) {
  return jwt.decode(token)
}

async function nisApi({ cookie = "", body = {}, url, method = "GET" }) {
  let options = {
    method,
    headers: { cookie, "user-agent": SESSION_USER_AGENT },
    signal: AbortSignal.timeout(15000),
  }
  if (method === "POST") options = Object.assign(options, { body })

  console.log("nisApi request:", method, url.split(".kz")[1])
  console.log("nisApi cookie:", cookie.slice(0, 200))
  const response = await fetch(url, options)
  console.log("nisApi response status:", response.status, "content-type:", response.headers.get("content-type"))

  if (!response.ok) {
    const err = new Error(response.statusText)
    err.code = response.status
    throw err
  }

  const rawText = await response.text()
  console.log("nisApi raw response:", rawText.slice(0, 300))

  const unauthorizedMessages = [
    "Сессия пользователя была завершена, перезагрузите страницу",
    "Время работы с дневником завершено. Для продолжения необходимо обновить модуль",
  ]

  const contentType = response.headers.get("content-type") || ""
  const isJSON = contentType.includes("text/json") || contentType.includes("application/json")

  if (!isJSON) {
    if (unauthorizedMessages.includes(rawText.trim())) {
      const err = new Error("Сессия пользователя была завершена")
      err.code = 401
      throw err
    }
    const err = new Error(rawText.slice(0, 200))
    err.code = 400
    throw err
  }

  let json
  try {
    json = JSON.parse(rawText)
  } catch(e) {
    const err = new Error("Не удалось распарсить ответ: " + rawText.slice(0, 100))
    err.code = 400
    throw err
  }

  if (!json.success) {
    console.log("nisApi error json:", JSON.stringify(json).slice(0, 300))
    if (unauthorizedMessages.includes(json.message)) {
      const err = new Error("Время работы с дневником завершено")
      err.code = 401
      throw err
    }
    const err = new Error(json.details || json.message)
    err.code = 400
    throw err
  }

  json.resCookie = cookieParse(response)
  return json
}
// Получить куки и токен из JWT
function getSessionFromToken(token) {
  const decoded = decodeToken(token)
  return {
    cookies: decoded?.cookies || "",
    account: decoded?.account || null,
  }
}

// Создать новый JWT токен
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" })
}

// Создать токен из куки браузера
export function createTokenFromCookies(cookieStr, city) {
  return signToken({ cookies: cookieStr, account: { city } })
}

// Получить капчу
export function setUserAgent(ua) {
  SESSION_USER_AGENT = ua
  console.log("User-Agent set to:", ua)
}

// Получить куки со страницы логина + sitekey reCAPTCHA
export async function getLoginSession(city) {
  const baseUrl = `https://sms.${city}.nis.edu.kz`

  const loginPage = await fetch(`${baseUrl}/root/Account/Login`, {
    headers: {
      "user-agent": FAKE_USER_AGENT,
      "accept-language": "ru-RU,ru;q=0.9",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  })
  const pageCookies = cookieParse(loginPage)
  let currentCookies = mergeCookies(pageCookies || "", "lang=ru-RU; path=/")

  // Получаем sitekey из RefreshCaptcha
  const capResponse = await fetch(`${baseUrl}/root/Account/RefreshCaptcha`, {
    headers: {
      cookie: currentCookies,
      "user-agent": FAKE_USER_AGENT,
      "x-requested-with": "XMLHttpRequest",
      "accept": "application/json, text/javascript, */*; q=0.01",
      "referer": `${baseUrl}/root/Account/Login`,
    },
  })
  const newCookies = cookieParse(capResponse)
  if (newCookies) currentCookies = mergeCookies(currentCookies, newCookies)

  const capJson = await capResponse.json().catch(() => ({}))
  const sitekey = capJson.data?.captchaData || null

  return { cookies: currentCookies, sitekey }
}

// Решить reCAPTCHA через 2captcha
export async function solveRecaptcha(sitekey, pageUrl) {
  const apiKey = process.env.TWOCAPTCHA_KEY
  if (!apiKey) throw new Error("TWOCAPTCHA_KEY не задан в .env")

  // Отправить задачу
  const submitRes = await fetch(
    `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${pageUrl}&json=1`
  )
  const submitJson = await submitRes.json()
  if (submitJson.status !== 1) throw new Error("2captcha отклонил задачу: " + submitJson.request)
  const taskId = submitJson.request

  // Ждём решения (до 2 минут)
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const resRes = await fetch(
      `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`
    )
    const resJson = await resRes.json()
    if (resJson.status === 1) return resJson.request
    if (resJson.request !== "CAPCHA_NOT_READY") throw new Error("2captcha ошибка: " + resJson.request)
  }
  throw new Error("2captcha: время ожидания истекло")
}

// Войти в систему
export async function loginUser({ city, login, password }) {
  const baseUrl = `https://sms.${city}.nis.edu.kz`

  // Шаг 1: загружаем страницу логина — получаем куки и verification token
  const loginPage = await fetch(`${baseUrl}/root/Account/Login`, {
    headers: {
      "user-agent": FAKE_USER_AGENT,
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "ru-RU,ru;q=0.9",
    },
    redirect: "follow",
  })
  const pageCookies = cookieParse(loginPage) || ""
  let cookies = mergeCookies(pageCookies, "lang=ru-RU; path=/")

  // Шаг 2: вытаскиваем __RequestVerificationToken из HTML
  const html = await loginPage.text()
  const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)
  const verificationToken = tokenMatch ? tokenMatch[1] : ""

  // Шаг 3: логинимся
  const params = new URLSearchParams()
  params.append("login", login)
  params.append("password", password)
  params.append("captchaInput", "")
  params.append("twoFactorAuthCode", "")
  params.append("application2FACode", "")
  if (verificationToken) {
    params.append("__RequestVerificationToken", verificationToken)
  }

  const res = await fetch(`${baseUrl}/root/Account/LogOn`, {
    method: "POST",
    headers: {
      cookie: cookies,
      "user-agent": FAKE_USER_AGENT,
      "content-type": "application/x-www-form-urlencoded",
      "x-requested-with": "XMLHttpRequest",
      "accept": "application/json, text/javascript, */*; q=0.01",
      "referer": `${baseUrl}/root/Account/Login`,
      "origin": baseUrl,
    },
    body: params,
  })

  const text = await res.text()
  console.log("NIS login response:", text.slice(0, 500))
  console.log("NIS login status:", res.status)
  console.log("Verification token found:", !!verificationToken)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error("Сервер вернул неожиданный ответ: " + text.slice(0, 200))
  }

  if (!body.success) {
    throw new Error(body.message || "Неверный логин или пароль")
  }

  const updatedCookies = cookieParse(res)
  const finalCookies = mergeCookies(cookies, updatedCookies || "")

  const token = signToken({ cookies: finalCookies, account: { login, city } })
  return { token, cookieString: finalCookies }
}

// Получить учебные годы
export async function getYears(token, city) {
  const { cookies } = getSessionFromToken(token)
  console.log("getYears city:", city)
  console.log("getYears cookies:", cookies)
  let result
  try {
    result = await nisApi({
      url: `https://sms.${city}.nis.edu.kz/Ref/GetSchoolYears?fullData=true`,
      cookie: cookies,
    })
  } catch(e) {
    console.log("getYears error:", e.message, "code:", e.code)
    throw e
  }
  const newToken = signToken({ cookies: result.resCookie ? mergeCookies(cookies, result.resCookie) : cookies, account: decodeToken(token).account })
  return {
    data: result.data.map((year) => ({
      Name: year.Name,
      Id: year.Id,
      isActual: year.Data?.IsActual || false,
    })),
    newToken,
  }
}

// Получить четверти
export async function getTerms(token, city, yearId) {
  const { cookies, account } = getSessionFromToken(token)
  const params = new URLSearchParams()
  params.append("schoolYearId", yearId)

  const result = await nisApi({
    method: "POST",
    url: `https://sms.${city}.nis.edu.kz/Ref/GetPeriods`,
    body: params,
    cookie: cookies,
  })

  const sorted = result.data.sort((a, b) => a.Name.localeCompare(b.Name))
  const currentQuarter = getCurrentQuarter()
  if (sorted[currentQuarter - 1]) sorted[currentQuarter - 1].isActual = true

  const newCookies = result.resCookie ? mergeCookies(cookies, result.resCookie) : cookies
  const newToken = signToken({ cookies: newCookies, account })

  return { data: sorted, newToken }
}

// Получить итоговые оценки (через JceDiary — как делает браузер)
export async function getGrades(token, city, yearId) {
  let { cookies, account } = getSessionFromToken(token)
  const baseUrl = `https://sms.${city}.nis.edu.kz`

  console.log("getGrades start, city:", city, "yearId:", yearId)

  // Получаем периоды
  const periodsParams = new URLSearchParams()
  periodsParams.append("schoolYearId", yearId)
  periodsParams.append("page", "1")
  periodsParams.append("start", "0")
  periodsParams.append("limit", "100")
  const periodsResult = await nisApi({
    method: "POST",
    body: periodsParams,
    cookie: cookies,
    url: `${baseUrl}/Ref/GetPeriods`,
  })
  const firstPeriod = periodsResult.data[0]
  console.log("getGrades periodId:", firstPeriod.Id)

  // GetParallels через JceDiary
  const parallelsParams = new URLSearchParams()
  parallelsParams.append("periodId", firstPeriod.Id)
  parallelsParams.append("page", "1")
  parallelsParams.append("start", "0")
  parallelsParams.append("limit", "100")
  const parallels = await nisApi({
    method: "POST",
    body: parallelsParams,
    cookie: cookies,
    url: `${baseUrl}/JceDiary/GetParallels`,
  })
  console.log("getGrades parallels:", JSON.stringify(parallels.data?.[0]).slice(0, 100))

  // GetKlasses через JceDiary
  const klassesParams = new URLSearchParams()
  klassesParams.append("periodId", firstPeriod.Id)
  klassesParams.append("parallelId", parallels.data[0].Id)
  klassesParams.append("page", "1")
  klassesParams.append("start", "0")
  klassesParams.append("limit", "100")
  const klasses = await nisApi({
    method: "POST",
    body: klassesParams,
    cookie: cookies,
    url: `${baseUrl}/JceDiary/GetKlasses`,
  })
  console.log("getGrades klasses:", JSON.stringify(klasses.data?.[0]).slice(0, 100))

  const realKlass = klasses.data.length === 1
    ? klasses.data[0]
    : klasses.data.find((cur, id) => {
        if (id === 0) return false
        return klasses.data[id - 1].Id === cur.Id
      }) || klasses.data[0]

  // GetStudents через JceDiary
  const studentsParams = new URLSearchParams()
  studentsParams.append("periodId", firstPeriod.Id)
  studentsParams.append("parallelId", parallels.data[0].Id)
  studentsParams.append("klassId", realKlass.Id)
  const students = await nisApi({
    method: "POST",
    body: studentsParams,
    cookie: cookies,
    url: `${baseUrl}/JceDiary/GetStudents`,
  })
  console.log("getGrades students:", JSON.stringify(students.data?.[0]).slice(0, 100))

  // GetJceDiary
  const diaryParams = new URLSearchParams()
  diaryParams.append("periodId", firstPeriod.Id)
  diaryParams.append("parallelId", parallels.data[0].Id)
  diaryParams.append("klassId", realKlass.Id)
  diaryParams.append("studentId", students.data[0].Id)
  const diaryLink = await nisApi({
    url: `${baseUrl}/JceDiary/GetJceDiary`,
    method: "POST",
    body: diaryParams,
    cookie: cookies,
  })

  const cookieResponse = await fetch(diaryLink.data.Url, {
    method: "POST",
    headers: { cookie: cookies, "user-agent": SESSION_USER_AGENT },
    body: diaryParams,
  })
  const newCookies = cookieParse(cookieResponse)
  if (newCookies) cookies = mergeCookies(cookies, newCookies)

  // GetSubjects — оценки по предметам
  const subjects = await nisApi({
    url: `${baseUrl}/Jce/Diary/GetSubjects`,
    method: "POST",
    body: diaryParams,
    cookie: cookies,
  })
  console.log("getGrades subjects count:", subjects.data?.length)
  console.log("first subject full:", JSON.stringify(subjects.data?.[0]))

  const newToken = signToken({ cookies, account })
  return { data: subjects.data || [], newToken }
}

// Получить детали по предмету (СОР/СОЧ)
export async function getSubjectDetail(token, city, journalId, evaluations) {
  let { cookies, account } = getSessionFromToken(token)
  const baseUrl = `https://sms.${city}.nis.edu.kz`

  const createEvalPromise = async (evalId) => {
    const params = new URLSearchParams()
    params.append("journalId", journalId)
    params.append("evalId", evalId)
    const response = await nisApi({
      url: `${baseUrl}/Jce/Diary/GetResultByEvalution`,
      method: "POST",
      body: params,
      cookie: cookies,
    })
    return response.data || []
  }

  // Берём первые два evaluation (СОР и СОЧ)
  const evals = evaluations.slice(0, 2)
  const data = await Promise.all(evals.map(evalId => createEvalPromise(evalId)))

  const newToken = signToken({ cookies, account })
  return { data, newToken }
}

// Получить расписание
export async function getSchedule(token, city, yearId, weekDate) {
  let { cookies, account } = getSessionFromToken(token)
  const baseUrl = `https://sms.${city}.nis.edu.kz`

  // Шаг 1: GetPeriods
  const periodsParams = new URLSearchParams()
  periodsParams.append("schoolYearId", yearId)
  periodsParams.append("page", "1")
  periodsParams.append("start", "0")
  periodsParams.append("limit", "100")
  const periods = await nisApi({
    method: "POST", body: periodsParams, cookie: cookies,
    url: `${baseUrl}/Ref/GetPeriods`,
  })
  const periodId = periods.data[0].Id

  // Шаг 1.5: заходим на страницу расписания чтобы инициализировать сессию
  const schedPage = await fetch(`${baseUrl}/MyScheduleRoute/Index/0`, {
    headers: {
      cookie: cookies,
      "user-agent": SESSION_USER_AGENT,
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "referer": baseUrl,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  })
  const schedCookies = cookieParse(schedPage)
  if (schedCookies) cookies = mergeCookies(cookies, schedCookies)
  console.log("schedule page status:", schedPage.status)

  // Шаг 2: GetStudents
  const studentsParams = new URLSearchParams()
  studentsParams.append("schoolYearId", yearId)
  studentsParams.append("date", weekDate || new Date().toISOString().split("T")[0] + "T00:00:00")
  studentsParams.append("type", "4")
  studentsParams.append("page", "1")
  studentsParams.append("start", "0")
  studentsParams.append("limit", "100")
  const students = await nisApi({
    method: "POST", body: studentsParams, cookie: cookies,
    url: `${baseUrl}/MySchedule/GetStudents`,
  })
  const studentId = students.data[0].Id

  // Шаг 3: GetMySchedule
  const scheduleParams = new URLSearchParams()
  scheduleParams.append("toDate", weekDate || new Date().toISOString().split("T")[0] + "T00:00:00")
  scheduleParams.append("schoolYearId", yearId)
  scheduleParams.append("studentId", studentId)
  scheduleParams.append("periodId", periodId)
  scheduleParams.append("type", "4")
  scheduleParams.append("weekdayId", "")
  scheduleParams.append("page", "1")
  scheduleParams.append("start", "0")
  scheduleParams.append("limit", "100")
  const schedule = await nisApi({
    method: "POST", body: scheduleParams, cookie: cookies,
    url: `${baseUrl}/MySchedule/GetMySchedule`,
  })

  // Шаг 4: GetWeeks для списка недель
  const weeksParams = new URLSearchParams()
  weeksParams.append("periodId", periodId)
  weeksParams.append("schoolYearId", yearId)
  weeksParams.append("page", "1")
  weeksParams.append("start", "0")
  weeksParams.append("limit", "100")
  const weeks = await nisApi({
    method: "POST", body: weeksParams, cookie: cookies,
    url: `${baseUrl}/MySchedule/GetWeeks`,
  })

  const newToken = signToken({ cookies, account })
  return { schedule: schedule.data || [], weeks: weeks.data || [], studentId, periodId, newToken }
}

// Получить дневник (оценки по предметам за четверть)
export async function getDiary(token, city, termId) {
  let { cookies, account } = getSessionFromToken(token)
  const params = new URLSearchParams()
  params.append("periodId", termId)

  const parallel = await nisApi({
    url: `https://sms.${city}.nis.edu.kz/JceDiary/GetParallels`,
    method: "POST",
    body: params,
    cookie: cookies,
  })
  params.append("parallelId", parallel.data[0].Id)

  const klasses = await nisApi({
    url: `https://sms.${city}.nis.edu.kz/JceDiary/GetKlasses`,
    method: "POST",
    body: params,
    cookie: cookies,
  })

  const realKlass =
    klasses.data.length === 1
      ? klasses.data[0]
      : klasses.data.find((cur, id) => {
          if (id === 0) return false
          return klasses.data[id - 1].Id === cur.Id
        })

  if (!realKlass) {
    const err = new Error("Класс ученика не найден")
    err.code = 404
    throw err
  }
  params.append("klassId", realKlass.Id)

  const student = await nisApi({
    url: `https://sms.${city}.nis.edu.kz/JceDiary/GetStudents`,
    method: "POST",
    body: params,
    cookie: cookies,
  })
  params.append("studentId", student.data[0].Id)

  const diaryLink = await nisApi({
    url: `https://sms.${city}.nis.edu.kz/JceDiary/GetJceDiary`,
    method: "POST",
    body: params,
    cookie: cookies,
  })

  const cookieResponse = await fetch(diaryLink.data.Url, {
    method: "POST",
    headers: { cookie: cookies, "user-agent": FAKE_USER_AGENT },
    body: params,
  })
  const newCookies = cookieParse(cookieResponse)
  if (newCookies) cookies = mergeCookies(cookies, newCookies)

  const periodsData = await nisApi({
    url: `https://sms.${city}.nis.edu.kz/Jce/Diary/GetSubjects`,
    method: "POST",
    body: params,
    cookie: cookies,
  })

  const newToken = signToken({ cookies, account })
  return {
    data: periodsData.data.map((el) => ({
      ...el,
      Evaluations: el.Evaluations?.map((el2) => el2.Id) || [],
    })),
    newToken,
  }
}

function getCurrentQuarter() {
  const month = new Date().getMonth() + 1
  if (month >= 9 && month <= 10) return 1
  if (month >= 11 && month <= 12) return 2
  if (month >= 1 && month <= 2) return 3
  return 4
}
