# Nieuwe features koppelen

Twee toevoegingen: **CSV-import** (transacties uit je bankafschrift inlezen) en **gedeelde toegang** (samen met je partner één budget delen). Zet de bestanden uit `budget-frontend/` in je `src/` naast `budget-app.jsx`.

> De bijgewerkte `db.js`, `server.js` en `api.js` vervangen die van vorige keer.
> Bestaande accounts en data migreren automatisch bij de eerste start — er gebeurt niets met je gegevens.

---

## 1. CSV-import

**Installeer de parser:**

```bash
npm install papaparse
```

**In `budget-app.jsx`:**

```js
import CsvImport from "./CsvImport";
```

Voeg een handler en knop toe. De handler hangt de transacties aan je bestaande data:

```js
const [csvOpen, setCsvOpen] = React.useState(false);

const importTransactions = (incoming) => {
  persist({ ...data, transactions: [...data.transactions, ...incoming] });
};
```

Zet een knop waar je wilt (bijv. naast "Vaste lasten" in het transacties-tabblad, of in het instellingen-menu):

```jsx
<button className="btn ghost" onClick={() => setCsvOpen(true)}>Importeer CSV</button>
```

En render de modal onderaan, bij je andere modals:

```jsx
{csvOpen && (
  <CsvImport
    existing={data.transactions}
    onImport={importTransactions}
    onClose={() => setCsvOpen(false)}
  />
)}
```

Dat is alles. De importer herkent de kolommen van de meeste Nederlandse banken automatisch, laat je ze anders handmatig koppelen, raadt categorie + privé/zakelijk per regel, en vinkt waarschijnlijke dubbele boekingen alvast uit. De categorie-regels staan in `categorize.js` — pas ze gerust aan op jouw vaste winkels en leveranciers.

---

## 2. Gedeelde toegang (huishouden)

De backend is omgebouwd: budgetdata hoort nu bij een **huishouden** in plaats van bij één gebruiker. Bij registratie krijgt iedereen een eigen huishouden; deel je met je partner, dan wijzen jullie naar hetzelfde. Je `storage`-adapter verandert hier niet voor — de server kiest zelf het juiste huishouden.

**In `budget-app.jsx`:**

```js
import Household from "./Household";
```

Open het scherm vanuit je instellingen-menu, en herlaad de data na een wijziging
(want na aansluiten/verlaten kijk je naar een ander budget):

```jsx
const [hhOpen, setHhOpen] = React.useState(false);

// knop:
<button className="btn ghost" onClick={() => setHhOpen(true)}>Delen met partner</button>

// modal:
{hhOpen && (
  <Household
    onClose={() => setHhOpen(false)}
    onChanged={() => window.location.reload()}
  />
)}
```

`window.location.reload()` is de simpelste manier om de nieuwe budgetdata op te halen. Wil je het zonder herladen, haal dan je laad-`useEffect` uit elkaar in een functie en roep die aan in `onChanged`.

**Zo werkt het uitnodigen:** jij opent "Delen met partner" en deelt de **deelcode**. Je partner maakt een account, opent hetzelfde scherm en vult de code in bij "Aansluiten bij een huishouden". Daarna zien jullie hetzelfde budget op al jullie apparaten.

---

## 3. Samen bewerken zonder verlies (versie-controle)

De server geeft elke opslag een oplopend versienummer. Sla je op terwijl je partner intussen iets wijzigde, dan weigert de server (HTTP 409) en stuurt de actuele data mee. De `storage`-adapter in `api.js` vangt dit automatisch op: hij **voegt beide kanten samen op transactie-niveau** (toevoegingen van allebei blijven behouden) en slaat opnieuw op. Je hoeft hier in de app-logica niets voor aan te passen — `persist` blijft hetzelfde.

**Eén kleine aansluiting** zodat de samenvoeging ook direct op je scherm verschijnt. Trek je laad-`useEffect` uit elkaar in een herbruikbare functie en registreer een handler:

```js
import { onRemoteUpdate, startSync, stopSync } from "./api";

const DEFAULTS = { reservePct: 35, reserveOn: true }; // zoals in de app

const applyData = (d) => setData({
  transactions: d.transactions || [],
  goals: d.goals || [],
  budgets: d.budgets || {},
  settings: { ...DEFAULTS, ...(d.settings || {}) },
});

useEffect(() => {
  onRemoteUpdate(applyData); // wordt aangeroepen bij een wijziging op afstand
  // ... je bestaande laadcode, maar via applyData(...) ...
}, []);
```

### Optioneel: bijna-live updates

Wil je dat wijzigingen van je partner vanzelf binnenkomen (in plaats van pas bij je eigen volgende opslag of na herladen), zet dan de lichte synchronisatie aan. Die peilt periodiek en roept je `onRemoteUpdate`-handler aan zodra er een nieuwere versie is:

```js
useEffect(() => {
  const id = startSync(15000); // elke 15 sec
  return () => stopSync(id);
}, []);
```

### Wat de samenvoeging doet

Toevoegingen en wijzigingen van beide kanten blijven behouden, bij een wijziging op hetzelfde item wint jouw lokale versie, en **verwijderingen blijven verwijderd** (zie sectie 4). Bewerkt iemand een item terwijl de ander het op precies hetzelfde moment verwijdert, dan wint de verwijdering — een zeldzaam dubbel-conflict met een voorspelbare uitkomst.

---

## 4. Verwijderingen die blijven (tombstones)

Probleem zonder dit: verwijder jij transactie X en sla je partner daarna op met een kopie waarin X nog stond, dan komt X terug. De oplossing is een **verwijdermarkering** per item. Een verwijdering haalt het item niet alleen weg, maar legt ook een klein merkpunt (`{ id: tijdstip }`) vast dat meereist in de samenvoeging. De merge in `api.js` (hierboven al bijgewerkt) filtert gemarkeerde items overal weg en ruimt markeringen ouder dan 90 dagen op.

Aan de app-kant zijn drie kleine, mechanische ingrepen nodig in `budget-app.jsx`:

**1. Voeg `deleted: {}` toe waar de data wordt geïnitialiseerd of genormaliseerd.**

```js
// begin-state:
useState({ transactions: [], goals: [], budgets: {}, settings: { ...DEFAULTS }, deleted: {} });

// in je laadcode / applyData uit sectie 3:
deleted: d.deleted || {},

// in resetAll:
persist({ transactions: [], goals: [], budgets: {}, settings: { ...DEFAULTS }, deleted: {} });
```

**2. Laat verwijderen een markering achter (i.p.v. alleen weghalen).**

```js
const delTx = (id) => persist({
  ...data,
  transactions: data.transactions.filter((x) => x.id !== id),
  deleted: { ...data.deleted, [id]: new Date().toISOString() },
});

const delGoal = (id) => persist({
  ...data,
  goals: data.goals.filter((x) => x.id !== id),
  deleted: { ...data.deleted, [id]: new Date().toISOString() },
});
```

**3. Filter gemarkeerde items uit wat je toont.** In de `tx`-useMemo, als eerste regel:

```js
let list = data.transactions.filter((x) => !data.deleted?.[x.id]);
// ... daarna je bestaande scope-filter en sortering ...
```

En voor doelen: voeg een afgeleide lijst toe en gebruik die overal waar je nu `data.goals` filtert:

```js
const liveGoals = useMemo(() => data.goals.filter((g) => !data.deleted?.[g.id]), [data.goals, data.deleted]);
// vervang vervolgens beide voorkomens van
//   data.goals.filter(g => scope === "alles" || g.scope === scope)
// door
//   liveGoals.filter(g => scope === "alles" || g.scope === scope)
```

Dat is alles. Verwijderingen worden nu netjes gesynchroniseerd, de back-up/export bevat de markeringen vanzelf (het is gewoon onderdeel van de data), en oude markeringen verdwijnen automatisch na 90 dagen.
