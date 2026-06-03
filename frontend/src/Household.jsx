import React, { useState, useEffect } from "react";
import { X, Users, Copy, RefreshCw, LogOut, Check, UserPlus, Crown } from "lucide-react";
import { household } from "./api";

// Beheer van gedeelde toegang. Roep onChanged() aan na join/leave zodat de app
// de (nu andere) budgetdata opnieuw laadt.
export default function Household({ onClose, onChanged }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => { try { const h = await household.get(); setInfo(h); setName(h.name); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); }, []);

  const copy = () => { navigator.clipboard?.writeText(info.joinCode); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const saveName = async () => { await household.rename(name.trim() || info.name); setEditName(false); load(); };
  const regen = async () => { if (!confirm("Nieuwe code aanmaken? De oude werkt daarna niet meer.")) return; await household.newCode(); load(); };
  const doJoin = async () => {
    setErr(""); setBusy(true);
    try { await household.join(joinCode); setJoinCode(""); await load(); onChanged && onChanged(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const doLeave = async () => {
    if (!confirm("Dit gedeelde huishouden verlaten? Je krijgt weer een eigen, leeg budget.")) return;
    setBusy(true);
    try { await household.leave(); await load(); onChanged && onChanged(); }
    finally { setBusy(false); }
  };

  const shared = info && info.members.length > 1;

  return (
    <div className="ovl" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
          .ovl { position:fixed; inset:0; background:rgba(30,43,37,0.4); backdrop-filter:blur(3px); display:flex; align-items:flex-end; justify-content:center; z-index:100; font-family:'Hanken Grotesk',sans-serif; }
          .sheet { background:#FBFAF5; color:#1E2B25; border-radius:22px 22px 0 0; padding:22px 18px 28px; width:100%; max-width:480px; max-height:92vh; overflow-y:auto; }
          .sh-h { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
          .sh-h h3 { font-family:'Fraunces',serif; font-weight:500; font-size:20px; }
          .xx { background:#F3EFE6; border:none; border-radius:9px; padding:7px; cursor:pointer; color:#7A7E73; display:grid; place-items:center; }
          .lbl { font-size:12px; font-weight:600; color:#7A7E73; letter-spacing:.3px; display:flex; align-items:center; gap:5px; margin-bottom:9px; }
          .namerow { display:flex; align-items:center; gap:8px; margin-bottom:20px; }
          .namerow .hh { font-family:'Fraunces',serif; font-size:22px; font-weight:500; }
          .namerow input { border:1px solid #E6E1D4; background:#F3EFE6; border-radius:10px; padding:8px 10px; font-family:inherit; font-size:16px; flex:1; }
          .mini { background:none; border:none; color:#1F5A47; font-weight:600; font-family:inherit; cursor:pointer; font-size:13px; }
          .members { display:flex; flex-direction:column; gap:8px; margin-bottom:20px; }
          .member { display:flex; align-items:center; gap:9px; background:#F3EFE6; border:1px solid #E6E1D4; border-radius:11px; padding:11px 13px; font-size:14px; }
          .avatar { width:30px; height:30px; border-radius:50%; background:#1F5A47; color:#fff; display:grid; place-items:center; font-weight:700; font-size:13px; flex-shrink:0; text-transform:uppercase; }
          .crown { margin-left:auto; color:#C29B3E; display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; }
          .codebox { background:#1F5A47; color:#fff; border-radius:14px; padding:16px; margin-bottom:8px; }
          .codebox .cl { font-size:11px; color:rgba(255,255,255,0.7); font-weight:600; letter-spacing:.5px; text-transform:uppercase; }
          .codeval { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:7px; }
          .codeval code { font-family:'Fraunces',serif; font-size:26px; letter-spacing:3px; }
          .codeval button { background:rgba(255,255,255,0.15); border:none; color:#fff; border-radius:9px; padding:8px 11px; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
          .hint { font-size:12.5px; color:#7A7E73; line-height:1.45; margin-bottom:20px; }
          .regen { background:none; border:none; color:#7A7E73; font-size:12px; font-family:inherit; cursor:pointer; display:inline-flex; align-items:center; gap:5px; margin-top:2px; }
          .divider { height:1px; background:#E6E1D4; margin:6px 0 18px; }
          .joinrow { display:flex; gap:8px; }
          .joinrow input { flex:1; border:1px solid #E6E1D4; background:#F3EFE6; border-radius:11px; padding:11px 13px; font-family:inherit; font-size:15px; letter-spacing:2px; text-transform:uppercase; }
          .joinrow button { border:none; background:#1F5A47; color:#fff; border-radius:11px; padding:0 16px; font-family:inherit; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
          .joinrow button:disabled { opacity:.5; }
          .err { background:rgba(194,75,51,0.1); color:#C24B33; font-size:13px; font-weight:500; padding:9px 12px; border-radius:10px; margin-top:10px; }
          .leave { width:100%; margin-top:16px; border:1px solid rgba(194,75,51,0.3); background:rgba(194,75,51,0.06); color:#C24B33; border-radius:12px; padding:12px; font-family:inherit; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:7px; }
        `}</style>

        <div className="sh-h"><h3>Gedeelde toegang</h3><button className="xx" onClick={onClose}><X size={18} /></button></div>

        {!info ? <p style={{ color: "#7A7E73", padding: 30, textAlign: "center" }}>{err || "Laden…"}</p> : (
          <>
            <div className="namerow">
              {editName ? (
                <>
                  <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && saveName()} />
                  <button className="mini" onClick={saveName}>Opslaan</button>
                </>
              ) : (
                <>
                  <span className="hh">{info.name}</span>
                  <button className="mini" onClick={() => setEditName(true)}>Naam wijzigen</button>
                </>
              )}
            </div>

            <div className="lbl"><Users size={14} /> {info.members.length === 1 ? "Alleen jij" : `${info.members.length} leden`}</div>
            <div className="members">
              {info.members.map((m) => (
                <div key={m.email} className="member">
                  <div className="avatar">{m.email[0]}</div>
                  <span>{m.email}</span>
                  {m.isOwner && <span className="crown"><Crown size={12} /> eigenaar</span>}
                </div>
              ))}
            </div>

            <div className="lbl"><UserPlus size={14} /> Nodig je partner uit</div>
            <div className="codebox">
              <div className="cl">Deelcode</div>
              <div className="codeval"><code>{info.joinCode}</code><button onClick={copy}>{copied ? <><Check size={14} /> Gekopieerd</> : <><Copy size={14} /> Kopieer</>}</button></div>
            </div>
            <p className="hint">Laat de ander een account aanmaken en deze code invullen onder "Aansluiten bij een huishouden". Jullie zien daarna hetzelfde budget.
              {info.isOwner && <><br /><button className="regen" onClick={regen}><RefreshCw size={12} /> Nieuwe code aanmaken</button></>}
            </p>

            <div className="divider" />

            <div className="lbl">Aansluiten bij een huishouden</div>
            <div className="joinrow">
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="DEELCODE" maxLength={12} onKeyDown={(e) => e.key === "Enter" && doJoin()} />
              <button onClick={doJoin} disabled={busy || !joinCode}>Aansluiten</button>
            </div>
            {err && <div className="err">{err}</div>}

            {shared && <button className="leave" onClick={doLeave} disabled={busy}><LogOut size={15} /> Dit huishouden verlaten</button>}
          </>
        )}
      </div>
    </div>
  );
}
