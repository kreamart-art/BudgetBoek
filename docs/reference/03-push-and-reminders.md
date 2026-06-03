# Pushberichten & herinneringen koppelen

Herinneringen die als **pushmelding** binnenkomen, gekoppeld aan een transactie met datum, instelbaar op een zelfgekozen aantal dagen van tevoren. Bestanden:

- Backend: `push-routes.js` (nieuw), plus `web-push` in `package.json` en VAPID-sleutels in `.env`.
- Frontend: `public/sw.js` (service worker), `push.js` (in-/uitschakelen), `DatePicker.jsx` (kalender).

---

## 1. Backend

```bash
cd budget-backend
npm install            # haalt web-push op
npx web-push generate-vapid-keys
```

Plak de twee sleutels in `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) en zet `VAPID_SUBJECT` op je eigen `mailto:`-adres.

Voeg in `server.js` twee regels toe — de import bovenaan, en de installatie ná het definiëren van de `auth`-middleware (en vóór `app.listen`):

```js
import { installPush } from "./push-routes.js";
// ... bestaande code ...
installPush(app, { auth });
```

Dat is alles aan de serverkant. `push-routes.js` maakt zelf zijn tabellen aan, biedt de endpoints (`/api/push/key`, `/subscribe`, `/unsubscribe`, `/test`) en start een **planner** die elk kwartier kijkt welke herinneringen aan de beurt zijn.

### Hoe de planner werkt

De planner leest per huishouden de transacties met een herinnering, berekent de melddatum (transactiedatum minus het aantal dagen), en stuurt op die dag één melding naar **alle leden** van het huishouden. Elke herinnering wordt per vervaldatum maar één keer verstuurd. Je hoeft hier niets extra's voor te synchroniseren: een transactie met `reminder` opslaan (wat de app al doet) is genoeg, want de planner leest dezelfde data.

---

## 2. Service worker

Zet `sw.js` in de map `public/` van je frontend, zodat het op `/sw.js` wordt geserveerd (zo doet Vite dat automatisch). `push.js` registreert hem zelf bij het inschakelen.

---

## 3. Herinnering in het transactie-venster

In `budget-app.jsx`, in `TxModal`:

```js
import DatePicker from "./DatePicker";
import { Bell, BellRing } from "lucide-react";
```

Voeg twee states toe:

```js
const [remind, setRemind] = useState(initial?.reminder?.enabled || false);
const [daysBefore, setDaysBefore] = useState(initial?.reminder?.daysBefore ?? 3);
```

Vervang het datumveld:

```jsx
{/* was: <label className="fld"><span>Datum</span><input type="date" .../></label> */}
<div className="fld"><span>Datum</span><DatePicker value={date} onChange={setDate} /></div>
```

> `date` is in de app al "YYYY-MM-DD"; dat sluit direct aan op DatePicker.

Voeg eronder het herinnering-blok toe:

```jsx
<button type="button" className={remind ? "toggle on" : "toggle"} onClick={() => setRemind(!remind)}>
  {remind ? <BellRing size={15} /> : <Bell size={15} />} Herinnering
  {remind && <Check size={15} style={{ marginLeft: "auto" }} />}
</button>
{remind && (
  <label className="fld"><span>Aantal dagen van tevoren</span>
    <input type="number" min="0" max="60" inputMode="numeric" value={daysBefore}
      onChange={(e) => setDaysBefore(e.target.value)} />
  </label>
)}
```

En neem de herinnering mee in `save`:

```js
reminder: remind
  ? { enabled: true, daysBefore: Math.max(0, parseInt(daysBefore) || 0) }
  : { enabled: false },
```

Klaar — de planner pikt het automatisch op.

---

## 4. Pushberichten aan-/uitzetten (instellingen)

In `SettingsModal` (of waar je instellingen toont):

```js
import { push } from "./push";

const [pushState, setPushState] = useState({ supported: true, enabled: false, permission: "default" });
useEffect(() => { push.status().then(setPushState); }, []);

const togglePush = async () => {
  try {
    if (pushState.enabled) await push.disable();
    else await push.enable();
    setPushState(await push.status());
  } catch (e) { alert(e.message); }
};
```

```jsx
{pushState.supported ? (
  <>
    <button className={pushState.enabled ? "toggle on" : "toggle"} onClick={togglePush}>
      <Bell size={15} /> Pushberichten ontvangen
      {pushState.enabled && <Check size={15} style={{ marginLeft: "auto" }} />}
    </button>
    {pushState.enabled && <button className="btn ghost full" onClick={() => push.sendTest()}>Stuur testmelding</button>}
    {pushState.permission === "denied" && <p className="muted">Meldingen zijn in je browser geblokkeerd; zet ze daar weer aan om dit te gebruiken.</p>}
  </>
) : (
  <p className="muted">Deze browser ondersteunt geen pushberichten.</p>
)}
```

---

## Belangrijk om te weten

- **HTTPS verplicht.** Web-push werkt alleen op `https://` (en op `http://localhost` tijdens ontwikkelen). Zet je het online, dan moet er een geldig certificaat zijn.
- **iPhone/iPad.** Safari stuurt alleen pushberichten als de app als **PWA aan het beginscherm** is toegevoegd (iOS 16.4+). In een gewoon browsertabblad werkt het op iOS niet — goed om te vermelden als je dit op je telefoon gebruikt.
- **Toestemming.** De gebruiker moet meldingen toestaan. Wordt het geweigerd, dan kan dat alleen via de browserinstellingen weer aangezet worden.
- **Tijdzone.** De planner werkt op dagniveau (UTC). Voor herinneringen is dat ruim voldoende; wil je een vast tijdstip op de dag, dan kun je de planner laten draaien op een gekozen uur.
- **Meerdere apparaten.** Elk apparaat waarop je inschakelt krijgt de melding. Dode abonnementen ruimt de server vanzelf op.
