import React, { useState, useRef, useEffect } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

// Datumkiezer met pop-up kalender. value/onChange werken met "YYYY-MM-DD".
// Optioneel: min ("YYYY-MM-DD") om eerdere datums te blokkeren.
const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const DOW = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const pad = (n) => String(n).padStart(2, "0");
const toISO = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const fmtLong = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

export default function DatePicker({ value, onChange, min }) {
  const [open, setOpen] = useState(false);
  const init = value ? new Date(value + "T00:00:00") : new Date();
  const [view, setView] = useState({ y: init.getFullYear(), m: init.getMonth() });
  const ref = useRef();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const today = new Date();
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());
  const startOffset = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // maandag = 0
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="dp" ref={ref}>
      <style>{`
        .dp { position:relative; }
        .dp-trigger { width:100%; display:flex; align-items:center; gap:9px; border:1px solid var(--line,#E6E1D4); background:var(--paper,#F3EFE6); border-radius:11px; padding:12px 13px; font-family:inherit; font-size:15px; color:var(--ink,#1E2B25); cursor:pointer; text-align:left; }
        .dp-trigger:hover { border-color:var(--green,#1F5A47); }
        .dp-trigger svg { color:var(--green,#1F5A47); flex-shrink:0; }
        .dp-pop { position:absolute; z-index:60; top:calc(100% + 6px); left:0; right:0; background:var(--card,#FBFAF5); border:1px solid var(--line,#E6E1D4); border-radius:14px; padding:12px; box-shadow:0 12px 32px rgba(30,43,37,0.15); }
        .dp-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
        .dp-head span { font-family:'Fraunces',serif; font-size:15px; text-transform:capitalize; }
        .dp-head button { background:var(--paper,#F3EFE6); border:none; border-radius:8px; padding:5px; cursor:pointer; color:var(--green,#1F5A47); display:grid; place-items:center; }
        .dp-dow { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; margin-bottom:4px; }
        .dp-dow span { text-align:center; font-size:10.5px; font-weight:700; color:#a9a394; text-transform:uppercase; padding:4px 0; }
        .dp-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
        .dp-day { aspect-ratio:1; border:none; background:none; border-radius:9px; font-family:inherit; font-size:13.5px; color:var(--ink,#1E2B25); cursor:pointer; display:grid; place-items:center; }
        .dp-day:hover:not(:disabled) { background:var(--paper,#F3EFE6); }
        .dp-day:disabled { color:#cfc8b8; cursor:default; }
        .dp-day.today { color:var(--green,#1F5A47); font-weight:700; }
        .dp-day.sel { background:var(--green,#1F5A47); color:#fff; font-weight:600; }
      `}</style>

      <button type="button" className="dp-trigger" onClick={() => setOpen((o) => !o)}>
        <Calendar size={16} /><span>{value ? fmtLong(value) : "Kies een datum"}</span>
      </button>

      {open && (
        <div className="dp-pop">
          <div className="dp-head">
            <button type="button" onClick={() => setView((v) => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 })}><ChevronLeft size={18} /></button>
            <span>{MONTHS[view.m]} {view.y}</span>
            <button type="button" onClick={() => setView((v) => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 })}><ChevronRight size={18} /></button>
          </div>
          <div className="dp-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="dp-grid">
            {cells.map((d, i) => {
              if (d === null) return <span key={i} />;
              const iso = toISO(view.y, view.m, d);
              const disabled = min && iso < min;
              return (
                <button type="button" key={i} disabled={disabled}
                  className={`dp-day${value === iso ? " sel" : ""}${iso === todayISO ? " today" : ""}`}
                  onClick={() => { onChange(iso); setOpen(false); }}>{d}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
