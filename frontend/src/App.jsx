import React, { useState } from "react";
import AuthScreen from "./AuthScreen";
import BudgetApp from "./BudgetApp";
import { api } from "./api";

export default function App() {
  const [authed, setAuthed] = useState(api.isLoggedIn());
  if (!authed) return <AuthScreen onAuth={() => setAuthed(true)} />;
  return <BudgetApp onLogout={() => { api.logout(); setAuthed(false); }} />;
}
