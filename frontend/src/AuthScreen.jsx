import React, { useState } from "react";
import { Wallet, Mail, Lock, ArrowRight } from "lucide-react";
import { api } from "./api";

// Toont een inlog/registratiescherm. Roept onAuth(user) aan na succes.
export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (mode === "register" && password.length < 8) { setError("Wachtwoord moet minstens 8 tekens zijn."); return; }
    setBusy(true);
    try {
      const user = mode === "login" ? await api.login(email, password) : await api.register(email, password);
      onAuth(user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
        .auth { font-family:'Hanken Grotesk',sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center;
          background:#F3EFE6; background-image:radial-gradient(circle at 0% 0%, rgba(194,155,62,0.1), transparent 45%); padding:20px; color:#1E2B25; }
        .auth-card { background:#FBFAF5; border:1px solid #E6E1D4; border-radius:22px; padding:34px 28px; width:100%; max-width:380px; box-shadow:0 10px 40px rgba(30,43,37,0.08); }
        .auth-brand { display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:#1F5A47; margin-bottom:14px; }
        .auth h1 { font-family:'Fraunces',serif; font-size:28px; font-weight:500; letter-spacing:-0.5px; margin-bottom:6px; }
        .auth .sub { color:#7A7E73; font-size:14px; margin-bottom:24px; }
        .auth-field { display:flex; align-items:center; gap:10px; border:1px solid #E6E1D4; background:#F3EFE6; border-radius:12px; padding:12px 14px; margin-bottom:12px; }
        .auth-field svg { color:#7A7E73; flex-shrink:0; }
        .auth-field input { border:none; background:none; outline:none; font-family:inherit; font-size:15px; width:100%; color:#1E2B25; }
        .auth-err { background:rgba(194,75,51,0.1); color:#C24B33; font-size:13px; font-weight:500; padding:10px 12px; border-radius:10px; margin-bottom:12px; }
        .auth-btn { width:100%; border:none; background:#1F5A47; color:#fff; border-radius:12px; padding:13px; font-size:15px; font-weight:600; font-family:inherit; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; transition:.15s; }
        .auth-btn:hover:not(:disabled) { background:#163b30; } .auth-btn:disabled { opacity:.6; cursor:default; }
        .auth-switch { text-align:center; margin-top:18px; font-size:13.5px; color:#7A7E73; }
        .auth-switch button { background:none; border:none; color:#1F5A47; font-weight:600; font-family:inherit; cursor:pointer; font-size:13.5px; }
      `}</style>
      <div className="auth-card">
        <div className="auth-brand"><Wallet size={16} /> Budgetboek</div>
        <h1>{mode === "login" ? "Welkom terug" : "Maak een account"}</h1>
        <p className="sub">{mode === "login" ? "Log in om bij je budget te komen." : "Je gegevens worden veilig op de server bewaard."}</p>

        <div className="auth-field"><Mail size={17} /><input type="email" placeholder="E-mailadres" value={email}
          onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoComplete="email" /></div>
        <div className="auth-field"><Lock size={17} /><input type="password" placeholder="Wachtwoord" value={password}
          onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoComplete={mode === "login" ? "current-password" : "new-password"} /></div>

        {error && <div className="auth-err">{error}</div>}

        <button className="auth-btn" onClick={submit} disabled={busy || !email || !password}>
          {busy ? "Even geduld…" : <>{mode === "login" ? "Inloggen" : "Account aanmaken"} <ArrowRight size={17} /></>}
        </button>

        <div className="auth-switch">
          {mode === "login" ? "Nog geen account? " : "Al een account? "}
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "Registreren" : "Inloggen"}
          </button>
        </div>
      </div>
    </div>
  );
}
