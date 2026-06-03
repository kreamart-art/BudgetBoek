# Budgetboek — gids voor Claude Code

Budgetbeheer-app (persoonlijk **én** zakelijk) voor een Nederlandse freelancer/huishouden. Twee delen: `backend/` (Node/Express + SQLite) en `frontend/` (React/Vite). De hele applicatie is in het **Nederlands**.

## Wat al klaar is vs. wat jij bouwt

**Klaar — gebruiken, niet herschrijven tenzij nodig:**
- `backend/db.js`, `backend/server.js`, `backend/push-routes.js` — de volledige API (auth, gedeelde budgetdata met versie-controle, huishoudens, pushberichten + planner).
- `frontend/src/api.js` — auth-client, `storage`-adapter, versie/merge-logica, `onRemoteUpdate`, `startSync`.
- `frontend/src/push.js` — pushberichten in-/uitschakelen.
- `frontend/src/categorize.js` — categorisatie-trefwoorden voor CSV-import.
- `frontend/src/DatePicker.jsx`, `AuthScreen.jsx`, `CsvImport.jsx`, `Household.jsx` — herbruikbare componenten.
- `frontend/src/App.jsx` (auth-gate) en **`frontend/src/BudgetApp.jsx` — de volledige app is geïmplementeerd** (dashboard, transacties met kalender + herinneringen, budget, forecast, doelen, alle modals, CSV-import, delen, pushschakelaar, versie-sync, tombstones).
- `frontend/public/sw.js` — service worker (push + PWA-levenscyclus).
- `frontend/public/manifest.webmanifest` + `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `badge.png`, gekoppeld in `index.html`; de worker wordt in `main.jsx` geregistreerd. **De app is installeerbaar (PWA).**

**Jouw taak:**
- Draaien en **verifiëren** dat alles werkt (zie het plan en de "verifieer"-stappen). Los eventuele runtime-/integratiefouten op.
- Optionele verbeteringen en **productie-hardening** (sterke `JWT_SECRET`, echte `CORS_ORIGIN`, HTTPS, evt. Postgres).

## Bronnen (lees deze)

- `docs/SPECIFICATION.md` — volledige functionele én technische spec. **Gezaghebbend.** Bevat datamodellen, API-contract, en pseudocode voor de lastige algoritmes (samenvoeging, planner, CSV).
- `docs/IMPLEMENTATION_PLAN.md` — gefaseerd bouwplan met checklist. **Volg dit, fase voor fase, en verifieer per fase.**
- `docs/reference/*.md` — exacte integratie-snippets (storage-adapter gebruiken, `onRemoteUpdate`-handler, tombstone-verwijderen, DatePicker in het transactieformulier, herinnering-velden, pushschakelaar in instellingen). **Hergebruik deze code letterlijk in `BudgetApp.jsx`.**

## Conventies

- **ESM** overal, **geen TypeScript**, **geen Tailwind/UI-library**: styling via `<style>`-blokken met CSS-variabelen.
- Componenten staan **plat in `frontend/src/`** (kleine codebase); relatieve imports zijn `./naam`.
- **Designtokens:** `--paper:#F3EFE6` `--card:#FBFAF5` `--ink:#1E2B25` `--muted:#7A7E73` `--green:#1F5A47` `--green-d:#163b30` `--gold:#C29B3E` `--pos:#2E7D5B` `--neg:#C24B33` `--line:#E6E1D4`; partner-accent `#2E6F8E`. Fonts: **Fraunces** (koppen/bedragen, serif) en **Hanken Grotesk** (body) via Google Fonts. Mobiel-first, max-breedte ~560px, modals als bottom-sheet.
- **Valuta:** `Intl.NumberFormat("nl-NL", { style:"currency", currency:"EUR" })`.

## Niet kapotmaken (invarianten)

- De budget-datablob heeft exact de vorm uit SPECIFICATION §4.2 (`transactions`, `goals`, `budgets`, `settings`, `deleted`).
- De `storage`-adapter in `api.js` houdt dezelfde `get()/set()`-vorm; bouw de app daarop, niet op een andere opslag.
- Versie-controle (HTTP 409) en tombstone-samenvoeging in `api.js` **niet wijzigen**; gebruik `onRemoteUpdate` + `startSync` in de app.
- **Verwijderen** zet een markering in `data.deleted` én filtert het item uit weergaven — haal het niet alleen uit de array (zie reference 02).

## Commando's

```bash
# backend
cd backend && npm install
cp .env.example .env            # vul JWT_SECRET; VAPID via: npx web-push generate-vapid-keys
npm start                       # http://localhost:4000

# frontend
cd frontend && npm install
cp .env.example .env            # VITE_API_URL=http://localhost:4000
npm run dev                     # http://localhost:5173
```

JWT-secret genereren: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

## Verifiëren

Na elke fase: backend én frontend draaien, een account registreren, en het gedrag van die fase controleren. Voor gelijktijdig bewerken: twee browsersessies (of normaal + incognito). Voor herinneringen: schakel push in en roep `POST /api/push/check-now` aan om de planner direct te draaien.

## Caveats

- **HTTPS verplicht** voor pushberichten (`http://localhost` uitgezonderd tijdens ontwikkelen).
- **iOS:** push werkt alleen als de app als PWA aan het beginscherm is toegevoegd (iOS 16.4+).
- Planner werkt op **dagniveau (UTC)**.
- SQLite is prima voor één server; gebruik **Postgres** op hosts met een tijdelijk bestandssysteem (zelfde queries, andere driver).
