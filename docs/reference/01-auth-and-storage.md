# De app aan de backend koppelen

Je bestaande `budget-app.jsx` werkt nu met `window.storage` (de opslag binnen een Claude-artifact). Om echte accounts te gebruiken draai je de app in je eigen project (bijv. Vite + React) en vervang je die opslag door de backend. Drie kleine ingrepen, geen herschrijving.

> Plaats `api.js` en `AuthScreen.jsx` naast `budget-app.jsx` in je `src/`.

## 1. Vervang de opslag

Bovenaan `budget-app.jsx`, voeg toe:

```js
import { storage, api } from "./api";
import AuthScreen from "./AuthScreen";
```

In de `BudgetApp`-component gebruikt de laad-`useEffect` nu `window.storage.get(...)`.
Verander beide aanroepen:

```js
// was: const r = await window.storage.get(STORAGE_KEY);
const r = await storage.get(STORAGE_KEY);
```

En in `persist`:

```js
// was: await window.storage.set(STORAGE_KEY, JSON.stringify(next));
await storage.set(STORAGE_KEY, JSON.stringify(next));
```

De interface is identiek (`get` geeft `{ value }`, `set(key, value)`), dus verder verandert er niets aan de app-logica.

## 2. Toon een inlogscherm wanneer nodig

Wikkel `BudgetApp` in een kleine wrapper die eerst inloggen afdwingt. Vervang je
`export default function BudgetApp() { ... }` door een hernoemde interne component
en zet er deze wrapper omheen:

```jsx
function BudgetApp() {  // <- haal het woord "export default" hier weg
  // ... bestaande app blijft ongewijzigd ...
}

export default function App() {
  const [authed, setAuthed] = React.useState(api.isLoggedIn());
  if (!authed) return <AuthScreen onAuth={() => setAuthed(true)} />;
  return <BudgetApp onLogout={() => { api.logout(); setAuthed(false); }} />;
}
```

## 3. (Optioneel) Een uitlogknop

In `BudgetApp` ontvang je nu `onLogout` als prop. Hang die bijvoorbeeld aan de
bestaande "Alle gegevens wissen"-sectie of zet er een knop bij in het tandwiel-menu:

```jsx
<button className="btn ghost full" onClick={onLogout}>Uitloggen</button>
```

## Omgevingsvariabele

Wijs de frontend naar je backend. In een Vite-project, in `.env`:

```
VITE_API_URL=http://localhost:4000
```

Laat je dit weg, dan gebruikt `api.js` standaard `http://localhost:4000`.

## Klaar

Start de backend (`npm start` in `budget-backend/`) en je frontend (`npm run dev`).
Registreer een account in het inlogscherm; daarna laadt en bewaart de app je data
automatisch op de server — op elk apparaat waarop je inlogt dezelfde gegevens.

> Tip: omdat de app alles in één blob opslaat, blijft de back-up/import-knop uit de
> instellingen gewoon werken als losse export naast je serveropslag.
