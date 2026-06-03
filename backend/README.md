# Budgetboek — Backend

Een kleine, zelf te hosten backend met accounts (registratie + login) en data-opslag per gebruiker. Gebouwd met Express, SQLite, bcrypt (wachtwoord-hashing) en JWT (sessies).

## Snel starten

```bash
cd budget-backend
npm install
cp .env.example .env        # en vul JWT_SECRET in
npm start
```

Genereer een sterke `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

De server draait daarna op `http://localhost:4000`. Er ontstaat automatisch een `budget.db`-bestand.

## Endpoints

| Methode | Pad                  | Auth | Doel                                  |
|---------|----------------------|------|---------------------------------------|
| POST    | `/api/auth/register` | nee  | Account aanmaken → `{ token, user }`  |
| POST    | `/api/auth/login`    | nee  | Inloggen → `{ token, user }`          |
| GET     | `/api/me`            | ja   | Ingelogde gebruiker ophalen           |
| GET     | `/api/budget`        | ja   | Budgetdata ophalen → `{ data }`       |
| PUT     | `/api/budget`        | ja   | Budgetdata opslaan (`{ data: {...} }`)|
| DELETE  | `/api/me`            | ja   | Account + data verwijderen            |
| GET     | `/health`            | nee  | Statuscheck                           |

Auth-routes verwachten een header `Authorization: Bearer <token>`.

## Even testen met curl

```bash
# Registreren
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@voorbeeld.nl","password":"geheim123"}'

# Gebruik de token uit het antwoord:
TOKEN=...

# Data opslaan
curl -s -X PUT http://localhost:4000/api/budget \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"data":{"transactions":[],"goals":[]}}'

# Data ophalen
curl -s http://localhost:4000/api/budget -H "Authorization: Bearer $TOKEN"
```

## Hoe de data is opgeslagen

De app beheert alles als één JSON-object (`transactions`, `goals`, `budgets`, `settings`). De backend bewaart dat als één rij per gebruiker in de tabel `budgets`. Simpel, en het sluit naadloos aan op de bestaande frontend. Wil je later per transactie kunnen zoeken/rapporteren aan de serverkant, dan splits je dit op in losse tabellen — de huidige opzet maakt die stap niet moeilijker.

## Naar productie

- **Sterke `JWT_SECRET`** en zet `CORS_ORIGIN` op je echte frontend-domein (geen `*`).
- **HTTPS** verplicht (zet er bijv. een reverse proxy als Caddy of Nginx voor).
- **Database**: SQLite is prima voor een enkele server. Op hosts met een tijdelijk
  bestandssysteem verlies je data bij een herstart — gebruik dan Postgres. Vervang
  `db.js` door een `pg`-pool en zet de queries om naar `$1, $2`-placeholders; de
  query-logica blijft gelijk.
- **Tokens**: nu in `localStorage` (eenvoudig). Veiliger tegen XSS is een `httpOnly`
  cookie met CSRF-bescherming; dat is een grotere wijziging.
- Overweeg een wachtwoord-reset-flow en e-mailverificatie als je echte gebruikers krijgt.

Niets in deze opzet doet aan beveiliging wat hoort: wachtwoorden worden gehasht met bcrypt (kostfactor 12), nooit in platte tekst opgeslagen, en login-pogingen zijn beperkt tegen brute force.
