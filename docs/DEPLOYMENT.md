# Deployment & productie-hardening (fase 10)

Twee beproefde sporen. **Spoor A** (aanbevolen): frontend op **Vercel**, backend + database op
**Coolify**. **Spoor B**: alles self-hosted op één server met **Docker Compose + Caddy**.

```
Frontend (Vercel)  ──HTTPS──►  Backend (Coolify, Docker)  ──►  Postgres (Coolify)
```

> **Waarom de backend niet op Vercel?** De backend is een langlopende server met een
> herinnering-planner (`setInterval`, elk kwartier) en gedeelde staat. Serverless-functies
> bevriezen tussen requests, dus de planner zou nooit vuren. Zet de backend op een platform
> dat een persistent proces draait (Coolify, een VPS, Render, Fly.io, Railway…).

---

## Database: SQLite of Postgres

De backend kiest de driver via env (zelfde queries, andere driver):

| Situatie | Instelling |
|----------|-----------|
| Lokaal / één server met persistente schijf | `DB_DRIVER=sqlite` (standaard), `DB_FILE=/data/budget.db` op een volume |
| Productie / efemeer bestandssysteem | `DB_DRIVER=postgres` + `DATABASE_URL=…` |

Zonder `DB_DRIVER` maar **mét** `DATABASE_URL` kiest de app automatisch Postgres — precies wat
Coolify/Heroku-achtige platforms aanleveren. Zet `PGSSL=require` als je provider TLS eist.

---

## Spoor A — Coolify (backend + DB) + Vercel (frontend)

### 1. Postgres op Coolify
- Maak in je project een **PostgreSQL**-resource aan.
- Kopieer de **interne** connection string (bijv. `postgres://user:pass@<service>:5432/budgetboek`).

### 2. Backend op Coolify
- Nieuwe resource → **Git-repository** → deze repo, build via de **Dockerfile** in `backend/`
  (zet "Base directory" op `/backend`, build pack = Dockerfile).
- **Environment variables:**
  ```
  NODE_ENV=production
  JWT_SECRET=<48-byte hex; node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
  CORS_ORIGIN=https://<jouw-vercel-domein>
  TRUST_PROXY=1
  DB_DRIVER=postgres
  DATABASE_URL=<de string uit stap 1>
  VAPID_PUBLIC_KEY=...        # npx web-push generate-vapid-keys
  VAPID_PRIVATE_KEY=...
  VAPID_SUBJECT=mailto:jij@jouwdomein.nl
  ```
- Stel een domein in (bijv. `api.jouwdomein.nl`). Coolify regelt HTTPS automatisch.
- Healthcheck-pad: `/health`.

### 3. Frontend op Vercel
- New Project → importeer de repo → **Root Directory = `frontend`** (Vercel detecteert Vite;
  `vercel.json` regelt caching van `sw.js`/assets).
- **Environment variable:** `VITE_API_URL=https://api.jouwdomein.nl` (build-time — Vite bakt
  het in; na wijziging opnieuw deployen).
- Deploy. Zet daarna `CORS_ORIGIN` op de backend op het uiteindelijke Vercel-domein.

> **Previews:** elke Vercel-preview krijgt een andere URL. Wil je die ook toelaten, voeg dan
> meerdere origins komma-gescheiden toe aan `CORS_ORIGIN`, of gebruik je eigen vaste domein.

**Alles op Coolify (zonder Vercel)?** Deploy de frontend als extra resource via
`frontend/Dockerfile` (build-arg `VITE_API_URL`), of als static site (build `npm run build`,
output `dist`). Dan zit je op één domein en heb je geen CORS nodig.

---

## Spoor B — Self-hosted met Docker Compose + Caddy

Eén server, één commando. Caddy regelt automatisch geldige certificaten.

```bash
cp .env.example .env        # vul JWT_SECRET, POSTGRES_PASSWORD, domeinen, VAPID…
docker compose up -d --build
```

Onderdelen (`docker-compose.yml`): `db` (Postgres + volume), `backend` (Dockerfile),
`frontend` (Vite-build achter nginx), `caddy` (reverse proxy + HTTPS op poort 80/443).
Wijs `APP_DOMAIN` en `API_DOMAIN` met DNS naar de server; daarna haalt Caddy de certificaten op.

---

## Environment-variabelen (backend)

| Variabele | Verplicht | Toelichting |
|-----------|-----------|-------------|
| `JWT_SECRET` | ✅ | Lang willekeurig; in productie ≥ 32 tekens (de server weigert anders te starten). |
| `CORS_ORIGIN` | ✅ (prod) | Echt frontend-domein, komma-gescheiden. Geen `*` in productie. |
| `NODE_ENV` | aanbevolen | `production` activeert de hardening-checks. |
| `TRUST_PROXY` | achter proxy | Aantal proxies (bijv. `1`) → correcte client-IP voor rate-limiting. |
| `DB_DRIVER` | – | `sqlite` (standaard) of `postgres`. |
| `DATABASE_URL` / `PG*` | bij postgres | Connectiestring of losse `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`. `PGSSL=require` voor TLS. |
| `DB_FILE` | bij sqlite | Pad naar het bestand; op een volume voor persistentie. |
| `VAPID_*` | voor push | `npx web-push generate-vapid-keys`. Leeg = push uit. |
| `PORT` | – | Standaard 4000. |

---

## Randvoorwaarden (zie ook SPEC §14)

- **HTTPS verplicht** voor pushberichten (uitgezonderd `http://localhost`). Coolify en Caddy
  regelen dit automatisch.
- **iOS:** push werkt alleen als de app als **PWA aan het beginscherm** is toegevoegd (iOS 16.4+).
- **Planner** draait op dagniveau (UTC) en stuurt per herinnering één melding naar alle leden.
- **Back-ups:** bij Postgres `pg_dump`; bij SQLite het bestand op het volume.

---

## SPEC §15 — "Klaar wanneer" (geverifieerd)

Alle punten end-to-end getest op **zowel SQLite als Postgres** (Fase 1 API-suite, browser-E2E,
gelijktijdig bewerken, en de pushplanner):

- [x] Registreren, inloggen, uitloggen; wachtwoorden gehasht (bcrypt 12); sessies via JWT.
- [x] Transacties toevoegen/bewerken/verwijderen (privé+zakelijk), categorieën, terugkerend, herinnering.
- [x] Dashboard: maandnavigatie, totaal/besteedbaar saldo, in/uit/resultaat, grootste uitgaven, inzichten.
- [x] Reservering belasting & BTW (instelbaar percentage).
- [x] Budgetten per categorie met overschrijdingswaarschuwing.
- [x] Forecast (6 maanden) met werkelijk-vs-prognose grafiek.
- [x] Spaardoelen met voortgang en benodigde maandinleg.
- [x] CSV-import met kolomherkenning, normalisatie, categorisatie, dubbele-detectie, voorvertoning.
- [x] Gedeelde huishoudens: uitnodigen, aansluiten, verlaten, hernoemen.
- [x] Versie-controle (409) + tombstone-samenvoeging; optionele live-sync.
- [x] Pushberichten in-/uitschakelen, testmelding, en herinneringen die op tijd binnenkomen.
- [x] Back-up exporteren/importeren; account verwijderen.
- [x] Volledig Nederlands, mobiel-first, in het beschreven designsysteem.
