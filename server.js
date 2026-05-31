import express from "express"
import { loginUser, getLoginSession } from "./api.js"
import dotenv from "dotenv"
dotenv.config()

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const PORT = process.env.WEB_PORT || 3000

// Главная страница входа
app.get("/login", (req, res) => {
  const userId = req.query.user || ""
  res.send(getLoginPage(userId))
})

// Обработка формы входа
app.post("/login", async (req, res) => {
  const { login, password, city, userId } = req.body

  if (!login || !password || !city) {
    return res.send(getLoginPage(userId, "Заполни все поля"))
  }

  try {
    const result = await loginUser({ city, login, password })
    // Возвращаем страницу с командой для бота
    res.send(getSuccessPage(result.cookieString, userId))
  } catch (e) {
    res.send(getLoginPage(userId, e.message, city))
  }
})

app.listen(PORT, () => {
  console.log(`🌐 Веб-сервер запущен на порту ${PORT}`)
})

const CITIES = [
  { code: "alm", name: "Алматы ФМН" },
  { code: "hbalm", name: "Алматы ХБН" },
  { code: "ast", name: "Астана ФМН" },
  { code: "hbast", name: "Астана ХБН" },
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

function getLoginPage(userId = "", error = "", selectedCity = "") {
  const cityOptions = CITIES.map(c =>
    `<option value="${c.code}" ${selectedCity === c.code ? "selected" : ""}>${c.name}</option>`
  ).join("")

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Вход — НИС Дневник</title>
  <link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;800&family=Golos+Text:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0f;
      --surface: #13131a;
      --border: #1e1e2e;
      --accent: #6c63ff;
      --accent2: #ff6584;
      --text: #e8e8f0;
      --muted: #6b6b8a;
    }

    body {
      font-family: 'Golos Text', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow: hidden;
    }

    body::before {
      content: '';
      position: fixed;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(ellipse at 30% 20%, rgba(108,99,255,0.15) 0%, transparent 50%),
                  radial-gradient(ellipse at 70% 80%, rgba(255,101,132,0.1) 0%, transparent 50%);
      pointer-events: none;
      z-index: 0;
    }

    .card {
      position: relative;
      z-index: 1;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 48px 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.5);
    }

    .logo {
      font-family: 'Unbounded', sans-serif;
      font-size: 28px;
      font-weight: 800;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }

    .subtitle {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 36px;
    }

    .error {
      background: rgba(255,101,132,0.1);
      border: 1px solid rgba(255,101,132,0.3);
      border-radius: 12px;
      padding: 12px 16px;
      color: var(--accent2);
      font-size: 14px;
      margin-bottom: 20px;
    }

    .field {
      margin-bottom: 16px;
    }

    label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
    }

    input, select {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      color: var(--text);
      font-family: 'Golos Text', sans-serif;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
      -webkit-appearance: none;
    }

    input:focus, select:focus {
      border-color: var(--accent);
    }

    select option {
      background: var(--surface);
    }

    button {
      width: 100%;
      background: linear-gradient(135deg, var(--accent), #8b85ff);
      border: none;
      border-radius: 12px;
      padding: 16px;
      color: white;
      font-family: 'Unbounded', sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 8px;
      transition: opacity 0.2s, transform 0.1s;
    }

    button:hover { opacity: 0.9; }
    button:active { transform: scale(0.98); }

    .note {
      margin-top: 24px;
      padding: 16px;
      background: rgba(108,99,255,0.08);
      border-radius: 12px;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">НИС Дневник</div>
    <div class="subtitle">Войди чтобы подключить бота</div>

    ${error ? `<div class="error">⚠️ ${error}</div>` : ""}

    <form method="POST" action="/login">
      <input type="hidden" name="userId" value="${userId}">

      <div class="field">
        <label>Город / Школа</label>
        <select name="city" required>
          <option value="">Выбери школу</option>
          ${cityOptions}
        </select>
      </div>

      <div class="field">
        <label>ИИН (логин)</label>
        <input type="number" name="login" placeholder="123456789012" required>
      </div>

      <div class="field">
        <label>Пароль</label>
        <input type="password" name="password" placeholder="••••••••" required>
      </div>

      <button type="submit">Войти →</button>
    </form>

    <div class="note">
      🔒 Данные используются только для входа в НИС. Пароль не сохраняется.
    </div>
  </div>
</body>
</html>`
}

function getSuccessPage(cookieString, userId) {
  const command = `/setcookies ${cookieString}`
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Успешно — НИС Дневник</title>
  <link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;800&family=Golos+Text:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0f;
      --surface: #13131a;
      --border: #1e1e2e;
      --accent: #6c63ff;
      --green: #4ade80;
      --text: #e8e8f0;
      --muted: #6b6b8a;
    }
    body {
      font-family: 'Golos Text', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    body::before {
      content: '';
      position: fixed;
      top: -50%; left: -50%;
      width: 200%; height: 200%;
      background: radial-gradient(ellipse at 50% 50%, rgba(74,222,128,0.1) 0%, transparent 50%);
      pointer-events: none;
    }
    .card {
      position: relative;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 48px 40px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.5);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    .title {
      font-family: 'Unbounded', sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: var(--green);
      margin-bottom: 8px;
    }
    .subtitle { color: var(--muted); font-size: 14px; margin-bottom: 28px; }
    .steps { margin-bottom: 24px; }
    .step {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 16px;
      font-size: 14px;
      line-height: 1.5;
    }
    .step-num {
      background: var(--accent);
      color: white;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .command-box {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      font-family: monospace;
      font-size: 12px;
      color: var(--green);
      word-break: break-all;
      margin-bottom: 16px;
      max-height: 80px;
      overflow: hidden;
    }
    .btn {
      width: 100%;
      background: linear-gradient(135deg, var(--accent), #8b85ff);
      border: none;
      border-radius: 12px;
      padding: 16px;
      color: white;
      font-family: 'Unbounded', sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .copied { background: linear-gradient(135deg, var(--green), #22c55e) !important; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <div class="title">Вход выполнен!</div>
    <div class="subtitle">Теперь подключи бота</div>

    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div>Скопируй команду ниже</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div>Открой Telegram бота и отправь эту команду</div>
      </div>
    </div>

    <div class="command-box" id="cmd">${command.slice(0, 100)}...</div>

    <button class="btn" id="copyBtn" onclick="copyCommand()">
      📋 Скопировать команду
    </button>
  </div>

  <script>
    const fullCommand = ${JSON.stringify(command)};
    function copyCommand() {
      navigator.clipboard.writeText(fullCommand).then(() => {
        const btn = document.getElementById('copyBtn');
        btn.textContent = '✅ Скопировано!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '📋 Скопировать команду';
          btn.classList.remove('copied');
        }, 2000);
      });
    }
  </script>
</body>
</html>`
}

export default app
