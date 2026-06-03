import React, { useState, useMemo } from "react";
import Papa from "papaparse"; // npm install papaparse
import { Upload, X, Check, FileText, AlertTriangle, Home, Briefcase } from "lucide-react";
import { guessCategory } from "./categorize";

// Categorieën — houd gelijk aan die in budget-app.jsx
const CATS = {
  prive: { uitgave: ["Wonen", "Boodschappen", "Vervoer", "Verzekeringen", "Abonnementen", "Vrije tijd", "Zorg", "Overig"], inkomst: ["Salaris", "Toeslagen", "Cadeau", "Overig"] },
  zakelijk: { uitgave: ["Software & tools", "Marketing", "Kantoor", "Belasting & BTW", "Verzekeringen", "Uitbesteding", "Overig"], inkomst: ["Freelance", "Project", "Overig"] },
};
const uid = () => Math.random().toString(36).slice(2, 10);

// kolomnamen die we per veld herkennen (substring, kleine letters)
const SYN = {
  date: ["datum", "date", "boekdatum", "transactiedatum", "rentedatum", "valutadatum"],
  amount: ["bedrag", "amount", "transactiebedrag"],
  description: ["naam / omschrijving", "naam tegenpartij", "tegenpartij", "omschrijving", "mededelingen", "mededeling", "description", "naam"],
  debitCredit: ["af bij", "af/bij", "bij/af", "debit/credit", "debet/credit", "mutatiesoort", "code"],
};
const guessCol = (headers, syns) => {
  const low = headers.map((h) => (h || "").toLowerCase());
  for (const s of syns) { const i = low.findIndex((h) => h.includes(s)); if (i >= 0) return headers[i]; }
  return "";
};

function parseAmount(raw, dc) {
  let s = String(raw ?? "").trim().replace(/\s/g, "").replace(/[€$]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", "."); // 1.234,56
  else if (s.includes(",")) s = s.replace(",", ".");
  let n = parseFloat(s);
  if (isNaN(n)) return null;
  let expense;
  if (dc != null && String(dc).trim() !== "") {
    const d = String(dc).trim().toLowerCase();
    expense = d.startsWith("af") || d === "d" || d.startsWith("debet") || d.startsWith("debit") || d === "-";
  } else expense = n < 0 || String(raw).trim().startsWith("-");
  return { amount: Math.abs(n), type: expense ? "uitgave" : "inkomst" };
}

function parseDate(raw) {
  const s = String(raw ?? "").trim();
  let d;
  if (/^\d{8}$/.test(s)) d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
  else if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s.slice(0, 10));
  else if (/^\d{2}[-/]\d{2}[-/]\d{4}/.test(s)) { const [dd, mm, yy] = s.slice(0, 10).split(/[-/]/); d = new Date(`${yy}-${mm}-${dd}`); }
  else d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

export default function CsvImport({ existing = [], onImport, onClose }) {
  const [rows, setRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [map, setMap] = useState({ date: "", amount: "", description: "", debitCredit: "" });
  const [overrides, setOverrides] = useState({}); // index -> { scope, category, include }
  const [fileName, setFileName] = useState("");

  const onFile = (file) => {
    setFileName(file.name);
    Papa.parse(file, {
      header: true, skipEmptyLines: true, delimitersToGuess: [",", ";", "\t", "|"],
      complete: (res) => {
        const h = res.meta.fields || [];
        setHeaders(h); setRows(res.data); setOverrides({});
        setMap({ date: guessCol(h, SYN.date), amount: guessCol(h, SYN.amount), description: guessCol(h, SYN.description), debitCredit: guessCol(h, SYN.debitCredit) });
      },
    });
  };

  const existingKeys = useMemo(() => {
    const s = new Set();
    for (const x of existing) s.add(`${(x.date || "").slice(0, 10)}|${Number(x.amount).toFixed(2)}|${(x.description || "").toLowerCase().slice(0, 18)}`);
    return s;
  }, [existing]);

  const preview = useMemo(() => {
    if (!rows || !map.date || !map.amount) return [];
    return rows.map((r, i) => {
      const date = parseDate(r[map.date]);
      const amt = parseAmount(r[map.amount], map.debitCredit ? r[map.debitCredit] : null);
      const description = (map.description ? String(r[map.description] ?? "") : "").trim();
      if (!date || !amt) return { i, invalid: true };
      const g = guessCategory(description, amt.type === "inkomst");
      const ov = overrides[i] || {};
      const scope = ov.scope || g.scope;
      const category = ov.category || (CATS[scope][amt.type].includes(g.category) ? g.category : "Overig");
      const dupKey = `${date.slice(0, 10)}|${amt.amount.toFixed(2)}|${description.toLowerCase().slice(0, 18)}`;
      const duplicate = existingKeys.has(dupKey);
      const include = ov.include != null ? ov.include : !duplicate;
      return { i, date, description, amount: amt.amount, type: amt.type, scope, category, duplicate, include, invalid: false };
    });
  }, [rows, map, overrides, existingKeys]);

  const valid = preview.filter((p) => !p.invalid);
  const selected = valid.filter((p) => p.include);
  const dupCount = valid.filter((p) => p.duplicate).length;

  const setOv = (i, patch) => setOverrides((o) => ({ ...o, [i]: { ...o[i], ...patch } }));
  const bulkScope = (scope) => { const o = { ...overrides }; valid.forEach((p) => { o[p.i] = { ...o[p.i], scope, category: CATS[scope][p.type][CATS[scope][p.type].length - 1] === "Overig" ? "Overig" : CATS[scope][p.type][0] }; }); setOverrides(o); };

  const doImport = () => {
    const tx = selected.map((p) => ({ id: uid(), type: p.type, scope: p.scope, amount: p.amount, category: p.category, date: p.date, description: p.description || p.category, recurring: false }));
    onImport(tx);
    onClose();
  };

  return (
    <div className="ovl" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
          .ovl { position:fixed; inset:0; background:rgba(30,43,37,0.4); backdrop-filter:blur(3px); display:flex; align-items:flex-end; justify-content:center; z-index:100; font-family:'Hanken Grotesk',sans-serif; }
          .sheet { background:#FBFAF5; color:#1E2B25; border-radius:22px 22px 0 0; padding:22px 18px 26px; width:100%; max-width:620px; max-height:92vh; overflow-y:auto; }
          .sh-h { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
          .sh-h h3 { font-family:'Fraunces',serif; font-weight:500; font-size:20px; }
          .xx { background:#F3EFE6; border:none; border-radius:9px; padding:7px; cursor:pointer; color:#7A7E73; display:grid; place-items:center; }
          .drop { border:2px dashed #E6E1D4; border-radius:14px; padding:30px 18px; text-align:center; cursor:pointer; transition:.15s; }
          .drop:hover { border-color:#1F5A47; background:#F3EFE6; }
          .drop p { color:#7A7E73; font-size:13.5px; margin-top:8px; }
          .drop input { display:none; }
          .lbl { font-size:12px; font-weight:600; color:#7A7E73; letter-spacing:.3px; }
          .maps { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:14px 0; }
          .maps label { display:flex; flex-direction:column; gap:5px; }
          .maps span { font-size:12px; font-weight:600; color:#7A7E73; }
          .maps select { border:1px solid #E6E1D4; background:#F3EFE6; border-radius:10px; padding:9px 10px; font-family:inherit; font-size:13.5px; color:#1E2B25; }
          .summ { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:6px 0 12px; font-size:13px; color:#7A7E73; }
          .tag { background:#F3EFE6; border:1px solid #E6E1D4; border-radius:20px; padding:4px 10px; font-weight:600; }
          .bulk { margin-left:auto; display:flex; gap:6px; }
          .bulk button { border:1px solid #E6E1D4; background:#FBFAF5; border-radius:8px; padding:5px 9px; font-size:12px; font-weight:600; font-family:inherit; cursor:pointer; color:#1E2B25; display:inline-flex; align-items:center; gap:4px; }
          .ptable { border:1px solid #E6E1D4; border-radius:12px; overflow:hidden; max-height:46vh; overflow-y:auto; }
          .prow { display:grid; grid-template-columns:18px 1fr auto auto auto; gap:8px; align-items:center; padding:9px 11px; border-bottom:1px solid #EFEADE; font-size:13px; }
          .prow:last-child { border-bottom:none; }
          .prow.off { opacity:.45; }
          .prow.dup .pdesc::after { content:" · mogelijk dubbel"; color:#C29B3E; font-weight:600; font-size:11px; }
          .pdesc { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
          .pdate { font-size:11px; color:#7A7E73; font-weight:400; }
          .pamt { font-family:'Fraunces',serif; white-space:nowrap; } .pamt.uit { color:#C24B33; } .pamt.ink { color:#2E7D5B; }
          .scopebtns { display:flex; gap:3px; }
          .scopebtns button { border:1px solid #E6E1D4; background:#FBFAF5; width:26px; height:26px; border-radius:7px; cursor:pointer; color:#7A7E73; display:grid; place-items:center; }
          .scopebtns button.on { background:#1F5A47; color:#fff; border-color:#1F5A47; }
          .pcat { border:1px solid #E6E1D4; background:#F3EFE6; border-radius:7px; padding:4px 6px; font-family:inherit; font-size:12px; max-width:120px; }
          .chk { width:17px; height:17px; accent-color:#1F5A47; cursor:pointer; }
          .imp { width:100%; margin-top:14px; border:none; background:#1F5A47; color:#fff; border-radius:12px; padding:13px; font-size:15px; font-weight:600; font-family:inherit; cursor:pointer; }
          .imp:disabled { opacity:.5; cursor:default; }
          .note { font-size:12px; color:#7A7E73; margin-top:10px; display:flex; gap:6px; align-items:flex-start; line-height:1.4; }
        `}</style>

        <div className="sh-h"><h3>Bankafschrift importeren</h3><button className="xx" onClick={onClose}><X size={18} /></button></div>

        {!rows ? (
          <label className="drop">
            <Upload size={26} style={{ color: "#1F5A47" }} />
            <div style={{ fontWeight: 600, marginTop: 8 }}>Kies een CSV-bestand</div>
            <p>Exporteer je transacties als CSV vanuit je bank (ING, Rabobank, ABN AMRO, bunq, …) en kies dat bestand hier.</p>
            <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
          </label>
        ) : (
          <>
            <div className="summ"><FileText size={15} /> <span style={{ fontWeight: 600, color: "#1E2B25" }}>{fileName}</span> · {valid.length} regels gelezen</div>

            <span className="lbl">Kolommen koppelen</span>
            <div className="maps">
              {[["date", "Datum"], ["amount", "Bedrag"], ["description", "Omschrijving"], ["debitCredit", "Af/Bij (optioneel)"]].map(([k, label]) => (
                <label key={k}><span>{label}</span>
                  <select value={map[k]} onChange={(e) => setMap({ ...map, [k]: e.target.value })}>
                    <option value="">(geen)</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>

            <div className="summ">
              <span className="tag">{selected.length} geselecteerd</span>
              {dupCount > 0 && <span className="tag" style={{ color: "#C29B3E" }}>{dupCount} mogelijk dubbel</span>}
              <div className="bulk">
                <button onClick={() => bulkScope("prive")}><Home size={12} /> alles privé</button>
                <button onClick={() => bulkScope("zakelijk")}><Briefcase size={12} /> alles zakelijk</button>
              </div>
            </div>

            <div className="ptable">
              {valid.slice(0, 150).map((p) => (
                <div key={p.i} className={`prow ${p.include ? "" : "off"} ${p.duplicate ? "dup" : ""}`}>
                  <input type="checkbox" className="chk" checked={p.include} onChange={(e) => setOv(p.i, { include: e.target.checked })} />
                  <div className="pdesc">{p.description || "—"}<div className="pdate">{new Date(p.date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}</div></div>
                  <div className={`pamt ${p.type === "uitgave" ? "uit" : "ink"}`}>{p.type === "uitgave" ? "−" : "+"}{new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(p.amount)}</div>
                  <div className="scopebtns">
                    <button className={p.scope === "prive" ? "on" : ""} onClick={() => setOv(p.i, { scope: "prive", category: undefined })} title="Privé"><Home size={13} /></button>
                    <button className={p.scope === "zakelijk" ? "on" : ""} onClick={() => setOv(p.i, { scope: "zakelijk", category: undefined })} title="Zakelijk"><Briefcase size={13} /></button>
                  </div>
                  <select className="pcat" value={p.category} onChange={(e) => setOv(p.i, { category: e.target.value })}>
                    {CATS[p.scope][p.type].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
              {valid.length > 150 && <div className="prow" style={{ gridTemplateColumns: "1fr", color: "#7A7E73", justifyItems: "center" }}>+ {valid.length - 150} regels meer worden ook geïmporteerd</div>}
            </div>

            <p className="note"><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: "#C29B3E" }} /> Regels die al lijken te bestaan zijn alvast uitgevinkt, zodat je niet dubbel importeert. Controleer de categorieën voor je bevestigt.</p>

            <button className="imp" onClick={doImport} disabled={selected.length === 0}><Check size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />{selected.length} transacties importeren</button>
          </>
        )}
      </div>
    </div>
  );
}
