# Budgetboek

Budgetbeheer voor persoonlijk én zakelijk gebruik: transacties, budgetten, forecast, spaardoelen, gedeelde huishoudens en pushherinneringen. React-frontend + Node/Express-backend met SQLite.

## Bouwen met Claude Code

Open deze map in Claude Code en zeg bijvoorbeeld:

> Lees `CLAUDE.md` en `docs/IMPLEMENTATION_PLAN.md` en bouw het project fase voor fase, te beginnen bij fase 0.

Claude Code leest `CLAUDE.md` automatisch in. De backend en de frontend-bouwblokken zijn al aanwezig; de hoofdtaak is `frontend/src/BudgetApp.jsx` afbouwen volgens de spec.

## Snel starten

```bash
# backend
cd backend && npm install
cp .env.example .env          # vul JWT_SECRET; VAPID via: npx web-push generate-vapid-keys
npm start                     # http://localhost:4000

# frontend (nieuwe terminal)
cd frontend && npm install
cp .env.example .env
npm run dev                   # http://localhost:5173
```

## Structuur

```
CLAUDE.md                     instructies voor Claude Code
docs/
  SPECIFICATION.md            volledige functionele + technische spec
  IMPLEMENTATION_PLAN.md      gefaseerd bouwplan met checklist
  reference/                  exacte integratie-snippets
backend/                      Express + SQLite (compleet)
frontend/                     React + Vite
  src/                        bouwblokken + App.jsx + BudgetApp.jsx (skelet)
  public/sw.js                service worker voor pushberichten
```
