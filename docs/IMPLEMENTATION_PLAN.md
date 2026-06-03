# Bouwplan

Bouw fase voor fase. Voltooi en **verifieer** elke fase voordat je verdergaat. Verwijzingen zoals "SPEC §10" wijzen naar `docs/SPECIFICATION.md`; "ref 02" naar `docs/reference/02-sharing-sync-tombstones.md`.

---

## Fase 0 — Opzet & smoke test
- [ ] `cd backend && npm install`; maak `.env` (sterke `JWT_SECRET`). VAPID mag voorlopig leeg (push staat dan uit).
- [ ] `npm start` → server draait op :4000; `GET /health` geeft `{ ok: true }`.
- [ ] `cd frontend && npm install`; maak `.env` met `VITE_API_URL=http://localhost:4000`.
- [ ] `npm run dev` → de app start, toont het inlogscherm (`AuthScreen`) en na inloggen het `BudgetApp`-skelet.

## Fase 1 — Backend verifiëren (geen code nodig)
- [ ] Registreer via curl (`POST /api/auth/register`), log in, en test `GET`/`PUT /api/budget` met de token. Zie de curl-voorbeelden in `backend/README.md`.
- [ ] Controleer dat `PUT` zonder de juiste `version` een `409` geeft met `current`.

## Fase 2 — App-shell
- [ ] `App.jsx` (al aanwezig) regelt de auth-gate; controleer in-/uitloggen.
- [ ] Begin `BudgetApp.jsx`: laad data via `storage.get()`, normaliseer via één `applyData`-functie (vul `transactions/goals/budgets/deleted` en `settings:{...DEFAULTS,...}`), registreer `onRemoteUpdate(applyData)`, en start `startSync()` (zie ref 02). Bouw de basis-layout: bovenbalk met begroeting, tandwiel (instellingen) en scope-filter (Alles/Privé/Zakelijk), plus tabbladen en een FAB. Zie SPEC §10.1–10.3.

## Fase 3 — Transacties (kern)
- [ ] `TxModal` (toevoegen/bewerken): segmented Uitgave/Inkomst + Privé/Zakelijk, bedrag, categorie (afhankelijk van scope+type, uit `CATS`), omschrijving, datum via **`DatePicker`** (zie ref 03), toggle terugkerend. Zie SPEC §10.4.
- [ ] Transactielijst: gegroepeerd per maand, zoeken (omschrijving+categorie) en filter (Alles/In/Uit), bewerken bij tik, en **verwijderen → tombstone** (`data.deleted[id]=now`, item uit weergave filteren — zie ref 02). Pills voor "mnd" (recurring) en bel (reminder).
- [ ] "Vaste lasten boeken" voor de geselecteerde maand (SPEC §10.6).
- [ ] **Verifieer:** toevoegen/bewerken/verwijderen werkt en blijft bewaard (herlaad de pagina).

## Fase 4 — Overzicht, budget, forecast, doelen
- [ ] Dashboard met maandnavigatie: totaal saldo, besteedbaar saldo (reservering, SPEC §10.7), inkomsten/uitgaven/resultaat deze maand, grootste uitgaven (top 5), spaardoelen-mini, en inzichten (SPEC §10.8).
- [ ] Budget-tab: maandlimieten per categorie met waarschuwing bij overschrijding (SPEC §10.3 + `BudgetModal`).
- [ ] Forecast-tab: `monthlyEst = round((recurNet + last3avg)/2)`, cumulatief saldo + 6 maanden prognose, area-grafiek werkelijk vs prognose (SPEC §10.3).
- [ ] Doelen-tab: voortgangsring, benodigde maandinleg bij een deadline, inleg toevoegen (`TopUpModal`, `GoalModal`).

## Fase 5 — Herinneringen
- [ ] Voeg in `TxModal` de herinnering toe: toggle + "aantal dagen van tevoren" (0–60) + voorvertoning "melding op {datum − dagen}", opslaan als `reminder:{enabled,daysBefore}` (zie ref 03 en SPEC §10.4/§9).
- [ ] **Verifieer** dat een transactie met herinnering correct wordt opgeslagen in de blob (de planner leest deze).

## Fase 6 — Import, delen, instellingen
- [ ] CSV-import: knop op het transactietab die `CsvImport` opent; `onImport` voegt transacties toe via `persist` (SPEC §8).
- [ ] `SettingsModal`: reservering (toggle + %), **pushschakelaar** via `push.js` + testmelding (ref 03), **Delen met partner** (opent `Household`), back-up export/import, alles wissen, uitloggen (SPEC §10.5).
- [ ] `Household` koppelen: na aansluiten/verlaten de data **herladen** via `onChanged` (= `storage.get()` + `applyData`) — het huishouden en dus de data zijn dan gewijzigd (ref 02, SPEC §10.9).

## Fase 7 — Gelijktijdig bewerken (end-to-end)
- [ ] Test met twee sessies: beiden voegen toe → na opslaan blijven beide behoud (409 → samenvoeging). Eén verwijdert, ander slaat met oude kopie op → verwijderd item blijft weg (tombstone). `startSync` laat wijzigingen vanzelf verschijnen.

## Fase 8 — Pushberichten (end-to-end)
- [ ] Genereer VAPID-sleutels (`npx web-push generate-vapid-keys`), vul `.env`, herstart de backend.
- [ ] Schakel push in via instellingen (toestemming verlenen), stuur een testmelding.
- [ ] Zet een transactie met een herinnering die vandaag zou moeten vuren en draai `POST /api/push/check-now`; controleer dat de melding binnenkomt bij alle leden van het huishouden.

## Fase 9 — PWA-afronding ✅ (geleverd)
- [x] `frontend/public/manifest.webmanifest` aanwezig (naam, `display:standalone`, `theme_color:#1F5A47`, iconen 192/512 + maskable) en gekoppeld in `index.html`.
- [x] `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `badge.png` aanwezig; service worker geregistreerd in `main.jsx`.
- [ ] Optioneel: controleer in Chrome DevTools → Application → Manifest dat de app installeerbaar is, en test "Aan beginscherm toevoegen" op iOS voor push.

## Fase 10 — Productie-hardening
- [ ] Sterke `JWT_SECRET`; `CORS_ORIGIN` op het echte frontend-domein (geen `*`).
- [ ] HTTPS (reverse proxy). Overweeg Postgres bij een tijdelijk bestandssysteem.
- [ ] Loop de "Klaar wanneer"-checklist in SPEC §15 na.
