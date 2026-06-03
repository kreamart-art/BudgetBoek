# Budgetboek — Volledige bouwspecificatie

Dit document beschrijft een compleet te bouwen budgetbeheer-applicatie. Het is bedoeld als enige bron voor een coding tool: implementeer het project zoals hieronder beschreven, inclusief datamodellen, API-contract, algoritmes, UI en designsysteem. Taal van de hele applicatie is **Nederlands**; bedragen in `nl-NL` / EUR.

---

## 1. Doel

Een budgetbeheer-app voor persoonlijk én zakelijk gebruik, gericht op een Nederlandse freelancer/huishouden. Kernwaarde: minder handwerk en in één oogopslag overzicht. De app ondersteunt accounts, gedeelde huishoudens (samen met een partner één budget), automatische bankimport, en pushherinneringen.

## 2. Tech stack

- **Frontend:** React (Vite), `lucide-react` (iconen), `recharts` (grafieken), `papaparse` (CSV). Styling via `<style>`-blokken met CSS-variabelen — **geen Tailwind, geen UI-library**. Mobiel-first.
- **Backend:** Node 18+ in **ESM** (`"type": "module"`), Express, `better-sqlite3`, `bcryptjs`, `jsonwebtoken`, `helmet`, `cors`, `express-rate-limit`, `web-push`.
- **Database:** SQLite (één bestand). Migratiepad naar Postgres optioneel.
- **Auth-token:** JWT in `localStorage` aan de clientzijde.

## 3. Mappenstructuur

```
budget-backend/
  package.json
  .env                  (niet committen; zie .env.example)
  .env.example
  db.js                 schema + migraties
  server.js             auth, gedeelde budgetdata, huishoudens
  push-routes.js        pushabonnementen + herinnering-planner
budget-frontend/
  package.json          (vite + react + lucide-react + recharts + papaparse)
  .env                  VITE_API_URL=...
  public/
    sw.js               service worker voor pushberichten
  src/
    main.jsx
    App.jsx             auth-gate → BudgetApp
    api.js              auth + storage-adapter + versie/merge + push-status helpers
    push.js             pushberichten in-/uitschakelen
    BudgetApp.jsx       hoofd-app
    components/
      AuthScreen.jsx
      DatePicker.jsx
      CsvImport.jsx
      Household.jsx
      categorize.js
```

> De frontend mag desgewenst in één `BudgetApp.jsx` worden samengevoegd; houd in dat geval dezelfde logische scheiding aan. `public/sw.js` blijft hoe dan ook een apart bestand (het is een aparte worker).

---

## 4. Datamodellen

### 4.1 SQLite-schema

```sql
CREATE TABLE households (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL DEFAULT 'Mijn huishouden',
  owner_id   INTEGER,
  join_code  TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  household_id  INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- budgetdata per HUISHOUDEN (niet per gebruiker), met versie voor concurrency
CREATE TABLE budgets (
  household_id INTEGER PRIMARY KEY,
  data         TEXT NOT NULL DEFAULT '{}',
  version      INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

CREATE TABLE push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  endpoint     TEXT UNIQUE NOT NULL,
  subscription TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE sent_reminders (
  key     TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Zet bij init `PRAGMA journal_mode = WAL` en `PRAGMA foreign_keys = ON`. De tabellen `push_subscriptions` en `sent_reminders` mogen door `push-routes.js` worden aangemaakt.

### 4.2 De budget-datablob (kolom `budgets.data`, JSON)

De hele app-status is één JSON-object. De backend behandelt het grotendeels opaak (alleen de planner leest `transactions` voor herinneringen).

```jsonc
{
  "transactions": [
    {
      "id": "ab12cd34",          // willekeurig, uniek
      "type": "uitgave",         // "inkomst" | "uitgave"
      "scope": "prive",          // "prive" | "zakelijk"
      "amount": 1200,            // positief getal
      "category": "Wonen",
      "date": "2026-06-01T00:00:00.000Z", // ISO
      "description": "Huur",
      "recurring": true,
      "reminder": { "enabled": true, "daysBefore": 3 } // optioneel
    }
  ],
  "goals": [
    { "id": "g1", "name": "Buffer", "target": 10000, "saved": 6200, "scope": "prive", "deadline": "" }
  ],
  "budgets": { "prive::Boodschappen": 450, "zakelijk::Marketing": 150 }, // sleutel = "scope::Categorie"
  "settings": { "reservePct": 35, "reserveOn": true },
  "deleted": { "id-van-verwijderd-item": "2026-06-01T10:00:00.000Z" }    // tombstones
}
```

### 4.3 Categorieën (vaste lijst, `CATS`)

```js
const CATS = {
  prive: {
    uitgave: ["Wonen","Boodschappen","Vervoer","Verzekeringen","Abonnementen","Vrije tijd","Zorg","Overig"],
    inkomst: ["Salaris","Toeslagen","Cadeau","Overig"],
  },
  zakelijk: {
    uitgave: ["Software & tools","Marketing","Kantoor","Belasting & BTW","Verzekeringen","Uitbesteding","Overig"],
    inkomst: ["Freelance","Project","Overig"],
  },
};
const DEFAULTS = { reservePct: 35, reserveOn: true };
```

De categorie-keuze in formulieren hangt af van `scope` + `type`.

---

## 5. Authenticatie

- Wachtwoorden hashen met **bcrypt (kostfactor 12)**, nooit in platte tekst.
- JWT (`{ id, email }`, 30 dagen), meegestuurd als `Authorization: Bearer <token>`.
- `express-rate-limit` op de auth-routes (bijv. 20 pogingen / 15 min / IP).
- Bij login een bcrypt-vergelijking uitvoeren óók als de gebruiker niet bestaat (tegen timing-lekken).
- E-mail valideren met een eenvoudige regex; wachtwoord minimaal 8 tekens.

| Methode | Pad | Auth | Body | Antwoord |
|---|---|---|---|---|
| POST | `/api/auth/register` | nee | `{ email, password }` | `201 { token, user:{email} }` |
| POST | `/api/auth/login` | nee | `{ email, password }` | `200 { token, user:{email} }` |
| GET | `/api/me` | ja | — | `{ user:{email} }` |
| DELETE | `/api/me` | ja | — | `{ ok:true }` (verwijdert gebruiker) |

Bij **register**: maak in één transactie een huishouden (met unieke `join_code`), zet de gebruiker als lid + eigenaar, en maak een lege `budgets`-rij voor dat huishouden (`data='{}'`, `version=0`).

---

## 6. Gedeelde huishoudens

Model: een gebruiker hoort bij **precies één** huishouden tegelijk. Samen delen = hetzelfde `household_id`. Budgetdata staat per huishouden.

Hulpfunctie `householdOf(userId)` leest `users.household_id` (altijd vers uit de DB, niet uit de token, want het kan wijzigen).

| Methode | Pad | Auth | Gedrag |
|---|---|---|---|
| GET | `/api/household` | ja | `{ name, joinCode, isOwner, members:[{email,isOwner}] }` |
| PUT | `/api/household` | ja | `{ name }` → hernoem huishouden |
| POST | `/api/household/code` | ja | alleen eigenaar; genereer nieuwe `join_code` → `{ joinCode }` |
| POST | `/api/household/join` | ja | `{ code }` → sluit aan bij dat huishouden |
| POST | `/api/household/leave` | ja | verlaat → krijg een nieuw, leeg eigen huishouden |

Regels:
- **join:** zoek huishouden op `join_code` (uppercase, trim). Onbekend → `404`. Verander `users.household_id` naar het doel. Ruim het oude huishouden op als het leeg achterblijft; anders draag eigenaarschap over aan een resterend lid. Rate-limit deze route.
- **leave:** maak een nieuw huishouden (met lege budgets-rij), zet de gebruiker daarop, en pas dezelfde opruim/overdracht-regel toe op het verlaten huishouden.
- `join_code`: ~8 hoofdletter-hex tekens, uniek.

---

## 7. Budgetdata met versie-controle en tombstones

### 7.1 Endpoints

| Methode | Pad | Auth | Body | Antwoord |
|---|---|---|---|---|
| GET | `/api/budget` | ja | — | `{ data, version, updatedAt }` |
| PUT | `/api/budget` | ja | `{ data, version }` | `200 { ok, version }` of `409 { error, current:{data,version} }` |

`GET`/`PUT` werken op de rij van het **huishouden** van de gebruiker (`householdOf`).

### 7.2 Optimistische concurrency (server)

`PUT` ontvangt de `version` waarop de wijziging is gebaseerd:

```
huidig = SELECT data, version WHERE household_id = hid
als geen rij:        INSERT version=1; return { ok, version:1 }
basis = (version == null) ? huidig.version : Number(version)
als basis != huidig.version:   return 409 { current:{ data, version } }
voer voorwaardelijke update uit:
  UPDATE budgets SET data=?, version=version+1, updated_at=now WHERE household_id=hid AND version=huidig.version
als changes == 0 (race):   return 409 { current: verse data+version }
anders:                    return { ok, version: huidig.version+1 }
```

De voorwaardelijke `WHERE ... AND version = ?` vangt ook een race tussen lezen en schrijven af.

### 7.3 Samenvoeging bij conflict (client)

De client houdt `currentVersion` bij. Bij een `409` voegt hij lokaal en server samen en slaat opnieuw op (max ~4 pogingen). Samenvoeg-regels:

```
mergeBudget(local, server):
  # tombstones samenvoegen: laatste tijdstip wint
  deleted = { ...server.deleted }
  voor (id, ts) in local.deleted:
    als !deleted[id] of new Date(ts) > new Date(deleted[id]): deleted[id] = ts

  # items per id samenvoegen; bij gelijk id wint LOKAAL; daarna gemarkeerde eruit
  mergeArr(a, b) = waarden van { ...byId(b), ...byId(a) } filter (x => !deleted[x.id])

  return {
    ...server, ...local,
    transactions: mergeArr(local.transactions, server.transactions),
    goals:        mergeArr(local.goals,        server.goals),
    budgets:  { ...server.budgets,  ...local.budgets  },   # lokaal wint per sleutel
    settings: { ...server.settings, ...local.settings },
    deleted:  pruneDeleted(deleted),                        # verwijder markeringen ouder dan 90 dagen
  }
```

Gedrag: toevoegingen/wijzigingen van beide kanten blijven behouden; **verwijderingen blijven verwijderd** (tombstone reist mee). Bij gelijktijdig bewerken-vs-verwijderen van hetzelfde item wint de **verwijdering** (voorspelbaar, eenvoudig).

### 7.4 Storage-adapter & bijna-live updates (client)

De frontend gebruikt een `storage`-object met dezelfde vorm als een key-value-store:
- `storage.get()` → `{ value: JSON.stringify(data) }`, en onthoud `currentVersion`.
- `storage.set(_key, valueJson)` → `PUT` met `{ data, version: currentVersion }`; bij `409` samenvoegen, `currentVersion` bijwerken, een geregistreerde `onRemoteUpdate(merged)`-handler aanroepen, en opnieuw proberen.
- `onRemoteUpdate(fn)`: de app registreert hiermee een functie die de (samengevoegde) data in de UI verwerkt.
- `startSync(intervalMs=15000)` / `stopSync(id)`: peilt periodiek `GET /api/budget`; is `version` hoger dan `currentVersion`, werk `currentVersion` bij en roep `onRemoteUpdate(serverData)` aan. Zo verschijnen wijzigingen van de partner vanzelf.

De app-zijde **normaliseert** binnenkomende data altijd via één functie (`applyData`): zet ontbrekende velden goed (`transactions:[], goals:[], budgets:{}, deleted:{}`, `settings:{...DEFAULTS, ...}`), en zet `setData(...)`. Gebruik `applyData` zowel bij het laden als in `onRemoteUpdate`.

---

## 8. CSV-import (bankafschrift)

Doel: transacties uit een bank-CSV inlezen met minimale handmatige stappen. Component `CsvImport` met props `{ existing, onImport, onClose }`.

Werking:
1. **Parse** met PapaParse (`header:true, skipEmptyLines:true, delimitersToGuess:[",",";","\t","|"]`).
2. **Kolommen automatisch herkennen** via een synoniemenwoordenboek (substring, kleine letters), met handmatige override per veld (dropdowns):
   - `date`: datum, date, boekdatum, transactiedatum, rentedatum, valutadatum
   - `amount`: bedrag, amount, transactiebedrag
   - `description`: naam / omschrijving, naam tegenpartij, tegenpartij, omschrijving, mededelingen, description, naam
   - `debitCredit` (optioneel): af bij, af/bij, bij/af, debit/credit, debet/credit, mutatiesoort, code
3. **Bedrag normaliseren** (`parseAmount`): verwijder spaties/€; `1.234,56` → punt=duizend, komma=decimaal; `12,34` → `12.34`. Teken bepalen: is er een Af/Bij-kolom, dan is "af"/"d"/"debet"/"debit"/"-" een **uitgave**; anders bepaalt het teken van het bedrag het (negatief of beginnend met "-" = uitgave). Sla absolute waarde op + `type`.
4. **Datum normaliseren** (`parseDate`): ondersteun `YYYYMMDD`, `YYYY-MM-DD`, `DD-MM-YYYY` / `DD/MM/YYYY`; val terug op `new Date(...)`. Output ISO.
5. **Categoriseren** (`guessCategory(description, isIncome)` uit `categorize.js`, zie §11) → `{ category, scope }`.
6. **Dubbele detectie:** vergelijk met `existing` op sleutel `datum(dag)|bedrag(2dec)|omschrijving(eerste 18 tekens, lowercase)`; markeer als mogelijk dubbel en vink standaard **uit**.
7. **Voorvertoning:** lijst met per regel een include-checkbox, scope-knoppen (privé/zakelijk), en een categorie-dropdown (opties afhankelijk van scope+type). Plus bulk-knoppen "alles privé / alles zakelijk". Toon eerste ~150 regels; importeer alle geselecteerde.
8. **Import:** maak transacties `{ id, type, scope, amount, category, date, description, recurring:false }` en geef ze via `onImport` aan de app, die ze aan `data.transactions` toevoegt (via `persist`).

---

## 9. Pushherinneringen

Herinneringen zijn gekoppeld aan een transactie met datum en vuren een instelbaar **aantal dagen van tevoren**.

### 9.1 Frontend

- **Service worker** `public/sw.js**: luistert op `push` (toont `showNotification(title, {body, icon, badge, tag, data:{url}})`) en op `notificationclick` (focus bestaand venster of open `url`).
- **push-client** `push.js`:
  - `supported()` = `serviceWorker` + `PushManager` + `Notification` aanwezig.
  - `status()` → `{ supported, enabled, permission }` (op basis van bestaande subscription + `Notification.permission`).
  - `enable()`: registreer `/sw.js`, vraag `Notification.requestPermission()`, haal VAPID-public-key op via `GET /api/push/key`, `pushManager.subscribe({ userVisibleOnly:true, applicationServerKey })` (converteer base64url → Uint8Array), en `POST /api/push/subscribe { subscription }`.
  - `disable()`: haal subscription op, `POST /api/push/unsubscribe { endpoint }`, dan `subscription.unsubscribe()`.
  - `sendTest()`: `POST /api/push/test`.

### 9.2 Backend (`push-routes.js`, `installPush(app, { auth })`)

VAPID instellen met `web-push.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)`. Staat een sleutel niet ingesteld, log een waarschuwing en zet push uit (endpoints geven dan nette fouten).

| Methode | Pad | Auth | Doel |
|---|---|---|---|
| GET | `/api/push/key` | nee | `{ key }` (VAPID public) |
| POST | `/api/push/subscribe` | ja | upsert subscription op `endpoint` |
| POST | `/api/push/unsubscribe` | ja | verwijder op `endpoint` (van deze gebruiker) |
| POST | `/api/push/test` | ja | stuur testmelding naar deze gebruiker |
| POST | `/api/push/check-now` | ja | draai de planner direct (handig bij testen) |

`sendToUser(userId, payload)`: stuur naar alle subscriptions van de gebruiker; bij statuscode `404`/`410` de dode subscription verwijderen.

### 9.3 Planner

Draai kort na opstarten en daarna elk kwartier (`setInterval`). Per huishouden:

```
vandaag = YYYY-MM-DD (UTC)
voor elke transactie t met t.reminder.enabled en t.date:
  days   = max(0, t.reminder.daysBefore)
  due    = YYYY-MM-DD van t.date
  fire   = YYYY-MM-DD van (t.date minus days dagen)
  als vandaag < fire of vandaag > due: skip      # alleen tussen meld- en vervaldatum
  key = `${household_id}:${t.id}:${due}`
  als key in sent_reminders: skip                # al verstuurd
  daysLeft = (due - vandaag) in dagen
  when = daysLeft<=0 ? "vandaag" : daysLeft==1 ? "morgen" : `over ${daysLeft} dagen`
  body = `${t.description||t.category||"Transactie"} — ${EUR(t.amount)} ${when}.`
  stuur { title:"Herinnering", body, url:"/", tag:key } naar ALLE leden van het huishouden
  INSERT key in sent_reminders
```

Eén melding per herinnering per vervaldatum, naar alle leden. Werkt op dagniveau (UTC); voldoende voor herinneringen.

---

## 10. Frontend-UI

Volledig Nederlands, mobiel-first (max-breedte ~560px, gecentreerd). Onderaan een zwevende **+**-knop (FAB) en kortstondige **toasts** voor bevestigingen.

### 10.1 Auth-gate (`App.jsx`)

Niet ingelogd → `AuthScreen`. Ingelogd → `BudgetApp` (met `onLogout`). `AuthScreen`: e-mail + wachtwoord, schakelen tussen inloggen/registreren, foutmelding bij mislukken; bij succes terug naar de app.

### 10.2 Bovenbalk

Begroeting + datum; rechts een tandwiel (opent Instellingen) en een scope-filter met drie knoppen: **Alles / Privé / Zakelijk** (filtert vrijwel de hele app).

### 10.3 Tabbladen

**Overzicht (dashboard)** — met maandnavigatie (◀ maand ▶, niet vooruit voorbij de huidige maand):
- Groot **totaal saldo** (som van alle transacties). Daaronder, als reservering aan staat en > 0: "Besteedbaar na reservering: €X".
- **Inzichten**-kaart (zie §10.8) indien er punten zijn.
- Twee kaarten: **Inkomsten** en **Uitgaven** deze maand.
- **Resultaat deze maand** (= inkomsten − uitgaven), met de uitgaven van vorige maand als referentie.
- **Reservering belasting & BTW** (indien aan): zie §10.7.
- **Grootste uitgaven** deze maand: top 5 categorieën met balkjes (aandeel van de maanduitgaven).
- **Spaardoelen** (mini): top 3 met voortgangsbalk; link naar het Doelen-tab.

**Transacties**:
- Zoekbalk (op omschrijving + categorie) en filter (Alles / In / Uit).
- Knop **"Vaste lasten"** boeken (zie §10.6) en knop **"Importeer CSV"** (opent `CsvImport`).
- Lijst gegroepeerd per maand. Per regel: icoon (in/uit), omschrijving (+ pill "mnd" bij `recurring`, + bel-pill bij `reminder.enabled`), categorie · scope · datum, bedrag (groen/rood), en een verwijderknop. **Tik op een regel = bewerken** (opent TxModal met die transactie).

**Budget**:
- Maandlimieten per categorie (`budgets`-map). Per categorie: besteed deze maand vs. limiet met balk; >80% goud, boven limiet rood + "X over budget". Knop "Instellen" opent `BudgetModal`.

**Forecast**:
- "Verwacht saldo over 6 maanden" + geschat maandresultaat.
- `recurNet` = som van netto van alle `recurring`-transacties. `last3avg` = gemiddeld netto van de laatste 3 maanden. `monthlyEst = round((recurNet + last3avg) / 2)`.
- Bouw 6 maanden historie van netto per maand; reken het cumulatieve saldo terug vanaf het huidige totaal; projecteer daarna 6 maanden vooruit met `monthlyEst`. Toon een area-grafiek met "Werkelijk" (doorgetrokken) en "Prognose" (gestreept).

**Doelen**:
- Per doel een voortgangsring (`conic-gradient`), bedrag gespaard/doel, "nog €X te gaan" of "behaald". Heeft het doel een `deadline`, toon de benodigde maandinleg: `ceil(restbedrag / resterende maanden)`. Knop "Inleg toevoegen" opent `TopUpModal`.

### 10.4 Modals (bottom-sheet stijl)

- **TxModal** (toevoegen/bewerken transactie):
  - Segmented: **Uitgave / Inkomst** en **Privé / Zakelijk** (resetten de categorie).
  - Bedrag (number), Categorie (afhankelijk van scope+type), Omschrijving.
  - **Datum via `DatePicker`** (kalender-popover; waarde "YYYY-MM-DD"; bij opslaan naar ISO).
  - Toggle **Maandelijks terugkerend**.
  - Toggle **Herinnering**; indien aan: number "Aantal dagen van tevoren" (0–60) + voorvertoning "Je krijgt een melding op {datum − dagen}". Sla op als `reminder:{enabled, daysBefore}` (of `{enabled:false}`).
- **GoalModal**: naam, doelbedrag, al gespaard, scope, optionele streefdatum.
- **TopUpModal**: bedrag toevoegen aan een doel.
- **BudgetModal**: per categorie (van de gekozen scope) een maandlimiet; leeg = geen limiet. Sleutel `scope::Categorie`.
- **SettingsModal** (zie §10.5).
- **Household** (zie §6/§10.9), **CsvImport** (zie §8), **DatePicker** (zie §10.10).

### 10.5 Instellingen (`SettingsModal`)

- **Reservering belasting & BTW**: toggle aan/uit + percentage (0–60, standaard 35).
- **Pushberichten ontvangen**: toggle die `push.enable()/disable()` aanstuurt; toon "Stuur testmelding" als aan; toon hint als `permission === "denied"`; verberg/meld als niet ondersteund.
- **Delen met partner**: knop die `Household` opent.
- **Back-up**: Exporteren (download de hele data als JSON) en Importeren (lees JSON-bestand, normaliseer, opslaan).
- **Alle gegevens wissen** (met bevestiging).
- **Uitloggen** (`onLogout`).

### 10.6 Vaste lasten boeken

Knop op het Transacties-tab. Bepaal unieke terugkerende posten via signatuur `type|scope|categorie|omschrijving|bedrag`. Voor de geselecteerde maand: voeg ontbrekende posten toe (datum = die maand met de dag van de template, max dag 28). Toon een toast met het aantal geboekte posten of "staan al geboekt".

### 10.7 Reservering (indicatie)

Bereken over het **huidige kalenderjaar**: zakelijke inkomsten − zakelijke uitgaven = winst (min. 0). `reservering = round(winst × reservePct/100)`. `besteedbaar = totaalSaldo − reservering`. Toon als kaart met disclaimer "indicatie, geen fiscaal advies". Alleen tonen als `reserveOn` en bedrag > 0.

### 10.8 Inzichten (automatisch, max 4)

- Resultaat deze maand negatief → waarschuwing met het tekort.
- Uitgaven ≥ 8% hoger/lager dan vorige maand → melding met percentage.
- Positief resultaat → "Je spaarde X% van je inkomsten."
- Budget-overschrijding per categorie → waarschuwing.

### 10.9 Household-scherm

Toon huishoudnaam (hernoembaar), ledenlijst (met eigenaar-markering), de **deelcode** (kopieerknop; eigenaar kan vernieuwen), een invoerveld om met een code **aan te sluiten**, en (bij meer dan één lid) een knop **verlaten**. Na aansluiten/verlaten moet de app de budgetdata **herladen** (het huishouden — en dus de data — is gewijzigd): roep een `onChanged` aan die `storage.get()` + `applyData(...)` uitvoert.

### 10.10 DatePicker (kalender)

Popover-kalender. Props `{ value:"YYYY-MM-DD", onChange, min? }`. Maand-navigatie, weekdagen **ma–zo** (maandag eerst), dagcellen met "vandaag"- en "geselecteerd"-accent, sluit bij klik buiten of na keuze. Nederlandse maand-/dagnamen.

---

## 11. Categorisatie-trefwoorden (`categorize.js`)

`guessCategory(description, isIncome)` → `{ category, scope }`. Eerste match wint; standaard `{ "Overig", "prive" }`. Een match in de zakelijke regels zet `scope:"zakelijk"`.

```js
const EXPENSE_RULES = [
  ["Boodschappen", ["albert heijn","ah to go","ah ","jumbo","lidl","aldi","plus ","dirk","spar","ekoplaza","picnic","hoogvliet","vomar","coop","supermarkt"]],
  ["Vervoer", ["ns ","ns-","ov-chipkaart","ovpay","shell","bp ","esso","tango","tinq","q8","anwb","greenwheels","uber","bolt.eu","gvb","ret ","htm","connexxion","parkeren","q-park","parkmobile","yellowbrick"]],
  ["Abonnementen", ["netflix","spotify","disney","videoland","hbo","ziggo","kpn","vodafone","t-mobile","odido","youfone","simyo","apple.com/bill","google storage","icloud","patreon"]],
  ["Wonen", ["vattenfall","eneco","essent","greenchoice","budget energie","vesteda","hypotheek","huur","waternet","vitens","dunea","pwn","brabant water","gemeente","waterschap","vve"]],
  ["Zorg", ["apotheek","huisarts","tandarts","fysio","zilveren kruis","cz ","vgz","menzis","ziekenhuis","ggz","optiek","hans anders","specsavers"]],
  ["Verzekeringen", ["verzekering","centraal beheer","inshared","fbto","allianz","nationale-nederlanden","nn ","aegon","ohra","ditzo","univé","interpolis","anwb verzekeren"]],
  ["Vrije tijd", ["pathe","kinepolis","restaurant","cafe","café","bar ","thuisbezorgd","uber eats","deliveroo","dominos","mcdonald","kfc","starbucks","basic-fit","basic fit","fitness","sportschool","bol.com","coolblue","zalando","bioscoop"]],
];
const BUSINESS_RULES = [
  ["Software & tools", ["adobe","figma","vercel","netlify","github","openai","anthropic","google workspace","notion","linear","slack","transip","vimexx","mijndomein","namecheap","aws","amazon web services","digitalocean","hetzner","cloudflare","framer","webflow"]],
  ["Belasting & BTW", ["belastingdienst","btw","omzetbelasting","inkomstenbelasting"]],
  ["Uitbesteding", ["fiverr","upwork","freelancer"]],
  ["Marketing", ["google ads","meta platforms","facebook ","linkedin ads","mailchimp"]],
];
const INCOME_RULES = [
  ["Salaris", ["salaris","loon","salary","periode-uitkering"]],
  ["Toeslagen", ["belastingdienst toeslagen","huurtoeslag","zorgtoeslag","kinderopvangtoeslag","kindgebonden"]],
];
```

---

## 12. Designsysteem

Warme, rustige "private banking"-uitstraling — geen standaard SaaS-blauw.

**Kleuren (CSS-variabelen):**
```
--paper:#F3EFE6;  --card:#FBFAF5;  --ink:#1E2B25;  --muted:#7A7E73;
--green:#1F5A47;  --green-d:#163b30;  --gold:#C29B3E;
--pos:#2E7D5B;  --neg:#C24B33;  --line:#E6E1D4;
partner-accent (tweede persoon / blauw): #2E6F8E
```

**Typografie (Google Fonts):** display/koppen en bedragen in **Fraunces** (serif, weight 500); body in **Hanken Grotesk**.

**Vorm:** kaarten met `border-radius:18px`, dunne rand `--line`, zeer subtiele schaduw, warme papier-achtergrond met een lichte goud-radiale gloed linksboven. Modals als **bottom-sheet** (afgeronde bovenhoeken, omhoog-animatie). Bedragen en grote getallen in serif. Iconen via `lucide-react`. Valuta-opmaak via `Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"})` (geheel getal voor overzichten, met centen in lijsten).

---

## 13. Omgeving & setup

**backend/.env** (zie `.env.example`):
```
JWT_SECRET=<lange willekeurige string>          # min. 16 tekens; genereer met crypto.randomBytes(48).toString('hex')
PORT=4000
CORS_ORIGIN=http://localhost:5173               # geen * in productie
VAPID_PUBLIC_KEY=                               # npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:jij@voorbeeld.nl
# DB_FILE=budget.db
```

**Starten:**
```
# backend
cd budget-backend && npm install && cp .env.example .env  # vul .env in
npm start

# frontend
cd budget-frontend && npm install
echo "VITE_API_URL=http://localhost:4000" > .env
npm run dev
```

In `server.js`: na het definiëren van de `auth`-middleware en de routes, vóór `app.listen`, de push-module installeren: `installPush(app, { auth })`.

---

## 14. Belangrijke randvoorwaarden

- **HTTPS verplicht** voor pushberichten (uitgezonderd `http://localhost` tijdens ontwikkelen).
- **iOS:** web-push werkt alleen als de app als **PWA aan het beginscherm** is toegevoegd (iOS 16.4+); in een gewoon Safari-tabblad niet.
- **Toestemming** voor meldingen kan geweigerd worden; dan alleen via browserinstellingen weer aan.
- **Tijdzone:** planner werkt op dagniveau (UTC).
- **Samen bewerken:** versie-controle + tombstones voorkomen verlies bij gelijktijdig bewerken; bij gelijktijdig bewerken-vs-verwijderen wint de verwijdering.
- **SQLite** is prima voor één server; op hosts met een tijdelijk bestandssysteem (data weg bij herstart) Postgres gebruiken — dezelfde queries, andere driver.
- Geen `localStorage`/`sessionStorage` in eventuele preview-omgevingen die dat blokkeren; in een normale deployment is `localStorage` voor de JWT prima.

---

## 15. Klaar wanneer

- [ ] Registreren, inloggen, uitloggen werken; wachtwoorden gehasht; sessies via JWT.
- [ ] Transacties toevoegen/bewerken/verwijderen (privé+zakelijk), met categorieën, terugkerend, en herinnering.
- [ ] Dashboard met maandnavigatie, totaal saldo, besteedbaar saldo, inkomsten/uitgaven/resultaat, grootste uitgaven, inzichten.
- [ ] Reservering belasting & BTW (instelbaar percentage).
- [ ] Budgetten per categorie met waarschuwing bij overschrijding.
- [ ] Forecast (6 maanden) met werkelijk-vs-prognose grafiek.
- [ ] Spaardoelen met voortgang en benodigde maandinleg.
- [ ] CSV-import met kolomherkenning, normalisatie, categorisatie, dubbele-detectie en voorvertoning.
- [ ] Gedeelde huishoudens: uitnodigen via deelcode, aansluiten, verlaten, hernoemen.
- [ ] Budgetdata gedeeld per huishouden met versie-controle (409) en tombstone-samenvoeging; optionele live-sync.
- [ ] Pushberichten: in-/uitschakelen, testmelding, en herinneringen die op tijd binnenkomen bij alle leden.
- [ ] Back-up exporteren/importeren; account verwijderen.
- [ ] Volledig Nederlands, mobiel-first, in het beschreven designsysteem.
