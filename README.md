# Agent Studio — Phase 1

AI-агенти для генерації Web3 технічних документів.
Tech Spec · Tokenomics · DeFi Audit

## Швидкий старт

### 1. Завантаж на GitHub

```bash
# Розпакуй ZIP, відкрий папку agent-studio в терміналі
git init
git add .
git commit -m "feat: Agent Studio Phase 1"
git remote add origin https://github.com/YOUR_USERNAME/agent-studio.git
git push -u origin main
```

### 2. Деплой на Netlify

1. netlify.com → **Add new site → Import from Git**
2. Вибери репо `agent-studio`
3. Налаштування збірки заповняться автоматично з `netlify.toml`
4. Додай **Environment Variables** (Site settings → Environment variables):

```
ANTHROPIC_API_KEY           = sk-ant-...
NEXT_PUBLIC_SUPABASE_URL    = https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJ...
SUPABASE_SERVICE_ROLE_KEY   = eyJ...
RESEND_API_KEY              = re_...
NEXT_PUBLIC_APP_URL         = https://YOUR-SITE.netlify.app
TAVILY_API_KEY              = tvly-... (опціонально)
```

5. **Deploy site**

### 3. Supabase міграція

```
Supabase Dashboard → SQL Editor
→ вставити вміст: supabase/migrations/001_agent_studio.sql
→ Run
```

### 4. Перевірка

Відкрий `https://YOUR-SITE.netlify.app/run` → заповни форму → запусти Research Agent

## Локальний запуск

```bash
pnpm install
cp .env.example apps/web/.env.local
# заповни apps/web/.env.local
pnpm dev
# → http://localhost:3000
```

## Структура

```
agent-studio/
├── apps/web/              # Next.js 15 додаток
├── packages/agents/       # Research Agent + TypeScript типи
├── packages/tools/        # Веб-пошук (Tavily)
└── supabase/migrations/   # SQL схема
```

## Phase 2 (в розробці)

- [ ] Writer Agent — генерація 14-сторінкового документу
- [ ] QA Agent — перевірка якості
- [ ] Delivery Agent — PDF + email через Resend
- [ ] Orchestrator — повний pipeline одним кліком
- [ ] Semantic memory — pgvector
