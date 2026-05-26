import fetch from "node-fetch"
import { URLSearchParams } from "url"
import jwt from "jsonwebtoken"
import dotenv from "dotenv"
dotenv.config()

const FAKE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36"

function cookieParse(res) {
  const rawCookies = res.headers.raw()["set-cookie"]
  if (!rawCookies) return null
  return rawCookies.map((cookie) => cookie.split(";")[0]).join("; ")
}

function stringToObject(cookieString) {
  if (!cookieString) return {}
  return Object.fromEntries(
    cookieString.split("; ").filter((c) => c.length).map((c) => c.split("="))
  )
}

function mergeCookies(oldCookie, newCookie) {
  if (!newCookie) return oldCookie || ""
  if (!oldCookie) return newCookie
  return Object.entries(
    Object.assign(stringToObject(oldCookie), stringToObject(newCookie))
  )
    .map((c) => c.join("="))
    .join("; ")
}

function decodeToken(token) {
  return jwt.decode(token)
}

async function nisApi({ cookie = "", body = {}, url, method = "GET" }) {
  let options = {
    method,
    headers: { cookie, "user-agent": FAKE_USER_AGENT },
  }
  if (method === "POST") options = Object.assign(options, { body })

  const response = await fetch(url, options)

  if (!response.ok) {
    const err = new Error(response.statusText)
    err.code = response.status
    throw err
  }

  const contentType = response.headers.get("content-type") || ""
  const isJSON = contentType.includes("text/json") || contentType.includes("application/json")

  if (!isJSON) {
    const message = await response.text()
    const unauthorizedMessages = [
      "Сессия пользователя была завершена, перезагрузите страницу",
      "Время работы с дневником завершено. Для продолжения необходимо обновить модуль",
    ]
    if (unauthorizedMessages.includes(message)) {
      const err = new Error("Сессия пользователя была завершена")
      err.code = 401
      throw err
    }
    const err = new Error(message)
    err.code = 400
    throw err
  }

  const json = await response.json()
  if (!json.success) {
    const unauthorizedMessages = [
      "Сессия пользователя была завершена, перезагрузите страницу",
      "Время работы с дневником завершено. Для продолжения необходимо обновить модуль",
    ]
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

// Получить капчу
export async function refreshCaptcha(city, cookies) {
  const baseUrl = `https://sms.${city}.nis.edu.kz`

  // Шаг 1: заходим на страницу логина — получаем начальные куки (всегда, не только если пустые)
  const loginPage = await fetch(`${baseUrl}/root/Account/Login`, {
    headers: {
      "user-agent": FAKE_USER_AGENT,
      "accept-language": "ru-RU,ru;q=0.9",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  })
  const pageCookies = cookieParse(loginPage)
  let currentCookies = mergeCookies(cookies || "", pageCookies || "")
  currentCookies = mergeCookies(currentCookies, "lang=ru-RU; path=/")

  // Шаг 2: запрашиваем капчу
  const response = await fetch(`${baseUrl}/root/Account/RefreshCaptcha`, {
    headers: {
      cookie: currentCookies,
      "user-agent": FAKE_USER_AGENT,
      "x-requested-with": "XMLHttpRequest",
      "accept": "application/json, text/javascript, */*; q=0.01",
      "referer": `${baseUrl}/root/Account/Login`,
    },
  })

  const newCookies = cookieParse(response)
  const merged = mergeCookies(currentCookies, newCookies || "")

  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error("Сервер вернул неожиданный ответ: " + text.slice(0, 200))
  }

  // Берём картинку даже если success=false — сервер иногда возвращает капчу с success:false
  const img = json.data?.base64img
  if (!img) {
    throw new Error("Капча не получена. Ответ сервера: " + JSON.stringify(json).slice(0, 200))
  }

  return {
    captcha: img,
    cookies: merged,
  }
}

// Войти в систему
export async function loginUser({ city, login, password, captchaInput, cookies }) {
  const mergedCookies = mergeCookies(cookies, "lang=ru-RU; path=/")
  const params = new URLSearchParams()
  params.append("login", login)
  params.append("password", password)
  params.append("captchaInput", captchaInput || "")
  params.append("twoFactorAuthCode", "")
  params.append("application2FACode", "")

  const res = await fetch(
    `https://sms.${city}.nis.edu.kz/root/Account/LogOn`,
    {
      method: "POST",
      headers: {
        cookie: mergedCookies,
        "user-agent": FAKE_USER_AGENT,
      },
      body: params,
    }
  )

  const body = await res.json()
  if (!body.success) {
    throw new Error(body.message || "Ошибка входа")
  }

  const updatedCookies = cookieParse(res)
  const finalCookies = mergeCookies(mergedCookies, updatedCookies)

  const token = signToken({ cookies: finalCookies, account: { login, city } })
  return { token }
}

// Получить учебные годы
export async function getYears(token, city) {
  const { cookies } = getSessionFromToken(token)
  const result = await nisApi({
    url: `https://sms.${city}.nis.edu.kz/Ref/GetSchoolYears?fullData=true`,
    cookie: cookies,
  })
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

// Получить итоговые оценки
export async function getGrades(token, city, yearId) {
  const { cookies, account } = getSessionFromToken(token)
  const params = new URLSearchParams()

  const organization = await nisApi({
    method: "POST",
    cookie: cookies,
    url: `https://sms.${city}.nis.edu.kz/reportcard/GetOrganizations`,
  })

  params.append("schoolYearId", yearId)
  params.append("organizationId", organization.data[0].Id)
  params.append("organizationInternalId", organization.data[0].Id)

  const parallels = await nisApi({
    method: "POST",
    body: params,
    cookie: cookies,
    url: `https://sms.${city}.nis.edu.kz/reportcard/GetParallels`,
  })
  params.append("parallelId", parallels.data[0].Id)

  const klasses = await nisApi({
    method: "POST",
    body: params,
    cookie: cookies,
    url: `https://sms.${city}.nis.edu.kz/reportcard/GetKlasses`,
  })
  params.append("klassId", klasses.data[0].Id)

  const students = await nisApi({
    method: "POST",
    body: params,
    cookie: cookies,
    url: `https://sms.${city}.nis.edu.kz/reportcard/GetStudents`,
  })
  params.append("personId", students.data[0].Id)
  params.append("isEditable", true)
  params.append("group", { property: "ComponentId", direction: "ASC" })

  const urlResult = await nisApi({
    method: "POST",
    body: params,
    cookie: cookies,
    url: `https://sms.${city}.nis.edu.kz/reportcard/GetUrl`,
  })

  const newCookies1 = urlResult.resCookie ? mergeCookies(cookies, urlResult.resCookie) : cookies

  await fetch(urlResult.data, {
    headers: { cookie: newCookies1, "user-agent": FAKE_USER_AGENT },
  })

  const grades = await nisApi({
    method: "POST",
    body: params,
    cookie: newCookies1,
    url: `https://sms.${city}.nis.edu.kz/ReportCardByStudent/GetData`,
  })

  const array = grades.data.filter(
    (grade) => grade.IsNotChosen && grade.ComponentName === "Инвариантный компонент"
  )
  const unique = [...new Map(array.map((item) => [item["SubjectName"], item])).values()]

  const newToken = signToken({ cookies: newCookies1, account })
  return { data: unique, newToken }
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
