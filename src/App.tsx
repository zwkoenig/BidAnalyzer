// App.tsx — Bid Analyzer (React + TypeScript + Tailwind)
// Consistency update: Budget Frontier now uses the same button-style collapse as other cards.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload, RefreshCw, Save, FolderOpen, FileDown } from "lucide-react";
import * as XLSX from "xlsx";

type AltIndex = number | "alt2A";

type Bidder = {
  id: number;
  name: string;
  baseBid: number;
  alternates: number[]; // Alt1..AltN as indexes 0..N-1
  alternate2A: number; // special-case Alt 2A
};

type ComboResult = {
  alternates: string; // label like "Base + Alt 1, Alt 2A"
  alternateIndices: AltIndex[]; // selected alternates for this combo
  winner: { name: string; total: number };
  allBids: { name: string; total: number }[]; // sorted ascending by total
};

const fmt$ = (n: number) =>
  `$${(Number(n) || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;

function enforceSelectionXOR(
  selection: AltIndex[],
  rules: Array<[AltIndex, AltIndex]>
) {
  const set = new Set<AltIndex>(selection);
  for (const [a, b] of rules) {
    if (set.has(a) && set.has(b)) set.delete(b);
  }
  return Array.from(set);
}

const STORAGE_KEY = "bidanalyzer_state_v1";

// ----- Defaults -----
const INITIAL_NUM_ALTERNATES = 2;
const INITIAL_HAS2A = false; // default unchecked
const INITIAL_XOR34 = false;
const INITIAL_ALT_LABELS = [
  "Alt 1",
  "Alt 2",
  "Alt 2A",
  "Alt 3",
  "Alt 4",
  "Alt 5",
  "Alt 6",
  "Alt 7",
  "Alt 8",
  "Alt 9",
  "Alt 10",
  "Alt 11",
  "Alt 12",
];
const INITIAL_ALT2A_LABEL = "Alt 2A";
const INITIAL_BUDGET_CAP: number | "" = "";
const INITIAL_TOP_N = 10;
const INITIAL_BIDDERS: Bidder[] = [
  {
    id: 1,
    name: "Contractor A",
    baseBid: 100000,
    alternates: [5000, 3000],
    alternate2A: 4000,
  },
  {
    id: 2,
    name: "Contractor B",
    baseBid: 105000,
    alternates: [4500, 2500],
    alternate2A: 3500,
  },
  {
    id: 3,
    name: "Contractor C",
    baseBid: 98000,
    alternates: [6000, 3500],
    alternate2A: 4200,
  },
];

export default function App() {
  // Config / toggles
  const [numAlternates, setNumAlternates] = useState<number>(
    INITIAL_NUM_ALTERNATES
  );
  const [has2A, setHas2A] = useState<boolean>(INITIAL_HAS2A);
  const [xor34, setXor34] = useState<boolean>(INITIAL_XOR34); // Alt3 vs Alt4

  // Labels & controls
  const [altLabels, setAltLabels] = useState<string[]>([...INITIAL_ALT_LABELS]);
  const [alt2ALabel, setAlt2ALabel] = useState<string>(INITIAL_ALT2A_LABEL);
  const [budgetCap, setBudgetCap] = useState<number | "">(INITIAL_BUDGET_CAP);
  const [topN, setTopN] = useState<number>(INITIAL_TOP_N);

  // Data
  const [bidders, setBidders] = useState<Bidder[]>([...INITIAL_BIDDERS]);

  // UI state
  const [selectedAlternates, setSelectedAlternates] = useState<AltIndex[]>([]);
  const [selectedContractor, setSelectedContractor] = useState<string>("");
  const [labelsOpen, setLabelsOpen] = useState<boolean>(true);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  const [dataEntryOpen, setDataEntryOpen] = useState<boolean>(true);
  const [topCombosOpen, setTopCombosOpen] = useState<boolean>(true);
  const [frontierOpen, setFrontierOpen] = useState<boolean>(true);

  // file input refs
  const snapshotInputRef = useRef<HTMLInputElement>(null);

  // ---------- load/save (localStorage) ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.numAlternates === "number")
        setNumAlternates(s.numAlternates);
      if (typeof s.has2A === "boolean") setHas2A(s.has2A);
      if (typeof s.xor34 === "boolean") setXor34(s.xor34);
      if (Array.isArray(s.bidders)) setBidders(s.bidders);
      if (Array.isArray(s.altLabels)) setAltLabels(s.altLabels);
      if (typeof s.alt2ALabel === "string") setAlt2ALabel(s.alt2ALabel);
      if (typeof s.topN === "number") setTopN(s.topN);
      if (typeof s.budgetCap === "number") setBudgetCap(s.budgetCap);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const snapshot = {
      numAlternates,
      has2A,
      xor34,
      bidders,
      altLabels,
      alt2ALabel,
      topN,
      budgetCap: budgetCap === "" ? undefined : budgetCap,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {}
  }, [
    numAlternates,
    has2A,
    xor34,
    bidders,
    altLabels,
    alt2ALabel,
    topN,
    budgetCap,
  ]);

  // Reset/Refresh handler
  const resetData = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setNumAlternates(INITIAL_NUM_ALTERNATES);
    setHas2A(INITIAL_HAS2A);
    setXor34(INITIAL_XOR34);
    setAltLabels([...INITIAL_ALT_LABELS]);
    setAlt2ALabel(INITIAL_ALT2A_LABEL);
    setBudgetCap(INITIAL_BUDGET_CAP);
    setTopN(INITIAL_TOP_N);
    setBidders([...INITIAL_BIDDERS]);
    setSelectedAlternates([]);
    setSelectedContractor("");
  };

  // Save / Load snapshot (JSON)
  const exportSnapshot = () => {
    const payload = {
      version: 1,
      numAlternates,
      has2A,
      xor34,
      altLabels,
      alt2ALabel,
      budgetCap: budgetCap === "" ? null : budgetCap,
      topN,
      bidders,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bid_analyzer_snapshot.json";
    a.click();
  };

  const importSnapshot: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const obj = JSON.parse(String(evt.target?.result || "{}"));
        const n =
          typeof obj.numAlternates === "number" && obj.numAlternates > 0
            ? obj.numAlternates
            : INITIAL_NUM_ALTERNATES;
        setNumAlternates(n);
        setHas2A(!!obj.has2A);
        setXor34(!!obj.xor34);
        if (Array.isArray(obj.altLabels)) {
          const next = Array.from(
            { length: n },
            (_, i) => obj.altLabels[i] ?? `Alt ${i + 1}`
          );
          setAltLabels(next);
        }
        setAlt2ALabel(
          typeof obj.alt2ALabel === "string"
            ? obj.alt2ALabel
            : INITIAL_ALT2A_LABEL
        );
        setBudgetCap(
          typeof obj.budgetCap === "number" ? obj.budgetCap : INITIAL_BUDGET_CAP
        );
        setTopN(typeof obj.topN === "number" ? obj.topN : INITIAL_TOP_N);
        if (Array.isArray(obj.bidders)) {
          const coerced: Bidder[] = obj.bidders.map((b: any, idx: number) => ({
            id: typeof b.id === "number" ? b.id : idx + 1,
            name: String(b.name ?? `Contractor ${idx + 1}`),
            baseBid: Number(b.baseBid) || 0,
            alternates: Array.from(
              { length: n },
              (_, i) => Number(b.alternates?.[i]) || 0
            ),
            alternate2A: Number(b.alternate2A) || 0,
          }));
          setBidders(coerced);
        }
        setSelectedAlternates([]);
        setSelectedContractor("");
      } catch {
        alert("Invalid snapshot file.");
      } finally {
        if (snapshotInputRef.current) snapshotInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  // CSV Template (matches importer headers)
  const downloadTemplateCSV = () => {
    const headers: string[] = ["Contractor", "Base Bid"];

    // Generate alternate headers with 2A in position 3
    for (let i = 0; i < numAlternates; i++) {
      if (i === 2) {
        // Position 3 (0-indexed as 2)
        headers.push("Alt 2A");
      } else if (i < 2) {
        headers.push(`Alt ${i + 1}`); // Alt 1, Alt 2
      } else {
        headers.push(`Alt ${i}`); // Alt 3, Alt 4, Alt 5, etc. (shifted by 1)
      }
    }

    const blankRow = new Array(headers.length).fill("");
    const rows = [headers, blankRow, blankRow, blankRow];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bid_template.csv";
    a.click();
  };

  // XOR rules
  const xorRules = useMemo<Array<[AltIndex, AltIndex]>>(() => {
    const rules: Array<[AltIndex, AltIndex]> = [];
    // Remove this line: if (has2A) rules.push([1, "alt2A"]);
    if (xor34 && numAlternates >= 4) rules.push([2, 3]); // Alt 3 XOR Alt 4
    return rules;
  }, [has2A, xor34, numAlternates]);

  // --------- CRUD / updates ---------
  const addBidder = () => {
    const newId = Math.max(0, ...bidders.map((b) => b.id)) + 1;
    setBidders((prev) => [
      ...prev,
      {
        id: newId,
        name: `Contractor ${String.fromCharCode(65 + prev.length)}`,
        baseBid: 0,
        alternates: Array(numAlternates).fill(0),
        alternate2A: 0,
      },
    ]);
  };

  const removeBidder = (id: number) =>
    setBidders((prev) => prev.filter((b) => b.id !== id));

  const updateBidder = (
    id: number,
    field: keyof Bidder,
    value: Bidder[typeof field]
  ) =>
    setBidders((prev) =>
      prev.map((b) => (b.id === id ? { ...b, [field]: value } : b))
    );

  const updateAlternate = (
    bidderId: number,
    alternateIndex: number,
    value: string | number
  ) =>
    setBidders((prev) =>
      prev.map((b) =>
        b.id === bidderId
          ? {
              ...b,
              alternates: b.alternates.map((alt, i) =>
                i === alternateIndex ? parseFloat(String(value)) || 0 : alt
              ),
            }
          : b
      )
    );

  const updateAlternate2A = (bidderId: number, value: string | number) =>
    setBidders((prev) =>
      prev.map((b) =>
        b.id === bidderId
          ? { ...b, alternate2A: parseFloat(String(value)) || 0 }
          : b
      )
    );

  const updateNumAlternates = (newNum: number) => {
    setNumAlternates(newNum);
    setBidders((prev) =>
      prev.map((b) => ({
        ...b,
        alternates: Array(newNum)
          .fill(0)
          .map((_, i) => (b.alternates[i] != null ? b.alternates[i] : 0)),
      }))
    );
    setSelectedAlternates([]);
    setAltLabels((prev) =>
      Array(newNum)
        .fill(0)
        .map((_, i) => prev[i] ?? `Alt ${i + 1}`)
    );
  };

  const toggleHas2A = () => {
    const next = !has2A;
    setHas2A(next);
    if (!next)
      setSelectedAlternates((prev) => prev.filter((x) => x !== "alt2A"));
  };

  const toggleAlternate = (indexOr2A: AltIndex) => {
    setSelectedAlternates((prev) => {
      const isOn = prev.some((x) => x === indexOr2A);
      let next = isOn
        ? prev.filter((x) => x !== indexOr2A)
        : [...prev, indexOr2A];

      // Only apply XOR rules for Alt 3/4 if enabled
      for (const [a, b] of xorRules) {
        if (next.includes(a) && next.includes(b)) {
          const toDrop = indexOr2A === a ? b : indexOr2A === b ? a : b;
          next = next.filter((x) => x !== toDrop);
        }
      }
      return Array.from(new Set(next));
    });
  };

  // --------- Import (Excel/CSV) ---------
  const coerceNumber = (v: unknown) => {
    const n =
      typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const normalizeRow = (obj: Record<string, any>): Omit<Bidder, "id"> => {
    const name: string = obj.Contractor || obj.Name || obj["Contractor Name"] || "";
    const base = coerceNumber(obj.Base ?? obj["Base Bid"] ?? obj["Base ($)"] ?? 0);

    // Build alternates array with Alt 2A in position 2
    const alternates: number[] = [];
    alternates[0] = coerceNumber(obj["Alt 1"] ?? 0);
    alternates[1] = coerceNumber(obj["Alt 2"] ?? 0);
    alternates[2] = coerceNumber(obj["Alt 2A"] ?? 0);
    
    // Add Alt 3 through Alt 12
    for (let i = 3; i <= 12; i++) {
      alternates[i] = coerceNumber(obj[`Alt ${i}`] ?? 0);
    }

    return { name, baseBid: base, alternates, alternate2A: 0 };
  };

  const handleImport: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    const reader = new FileReader();

    reader.onload = (evt) => {
      const data = evt.target?.result as ArrayBuffer | string | null;
      try {
        if (ext === "xlsx" || ext === "xls") {
          const wb = XLSX.read(data as ArrayBuffer, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws);
          const normalized = (json as Record<string, any>[])
            .map(normalizeRow)
            .filter((r) => r.name);
          const maxAlts = 13;
          setNumAlternates(maxAlts);
          setBidders(
            normalized.map((r, idx) => ({
              id: idx + 1,
              name: r.name,
              baseBid: r.baseBid,
              alternates: r.alternates,
              alternate2A: 0,
            }))
          );
          setSelectedAlternates([]);
          setAltLabels(["Alt 1", "Alt 2", "Alt 2A", "Alt 3", "Alt 4", "Alt 5", "Alt 6", "Alt 7", "Alt 8", "Alt 9", "Alt 10", "Alt 11", "Alt 12"]);
        } else if (ext === "csv") {
          const text = new TextDecoder().decode(data as ArrayBuffer);
          const lines = text.split(/\r?\n/).filter(Boolean);
          const headers = lines[0].split(",").map((h) => h.trim());
          const rows = lines.slice(1).map((line) => {
            const cols = line.split(",");
            const obj: Record<string, string> = {};
            headers.forEach((h, i) => (obj[h] = cols[i]));
            return obj;
          });
          const normalized = rows.map(normalizeRow).filter((r) => r.name);
          const maxAlts = 13;
          setNumAlternates(maxAlts);
          setBidders(
            normalized.map((r, idx) => ({
              id: idx + 1,
              name: r.name,
              baseBid: r.baseBid,
              alternates: r.alternates,
              alternate2A: 0,
            }))
          );
          setSelectedAlternates([]);
          setAltLabels(["Alt 1", "Alt 2", "Alt 2A", "Alt 3", "Alt 4", "Alt 5", "Alt 6", "Alt 7", "Alt 8", "Alt 9", "Alt 10", "Alt 11", "Alt 12"]);
        } else {
          alert("Please upload a .xlsx, .xls, or .csv file.");
        }
      } catch (err) {
        console.error(err);
        alert(
          "Could not parse the file. Please check the format and try again."
        );
      } finally {
        e.target.value = ""; // reset input
      }
    };

    reader.readAsArrayBuffer(file);
  };

  // --------- calculations ---------
  const labelFor = (idx: AltIndex) =>
    idx === "alt2A"
      ? alt2ALabel
      : altLabels[Number(idx)] ?? `Alt ${Number(idx) + 1}`;

  const calcTotal = (bidder: Bidder, altIndices: AltIndex[] = []) =>
    bidder.baseBid +
    altIndices.reduce((sum, idx) => {
      if (idx === "alt2A") return sum + (bidder.alternate2A || 0);
      return sum + (bidder.alternates[idx] || 0);
    }, 0);

  const allAlternatesUniverse = useMemo<AltIndex[]>(
    () =>
      has2A
        ? [...Array(numAlternates).keys(), "alt2A"]
        : [...Array(numAlternates).keys()],
    [numAlternates, has2A]
  );

  const isValidCombo = (combo: AltIndex[]) =>
    !xorRules.some(([a, b]) => combo.includes(a) && combo.includes(b));

  const getAllCombinations = (): ComboResult[] => {
    const U = allAlternatesUniverse;
    const N = U.length;
    const combos: ComboResult[] = [];

    for (let mask = 0; mask < 1 << N; mask++) {
      const combo: AltIndex[] = [];
      for (let i = 0; i < N; i++) if (mask & (1 << i)) combo.push(U[i]);
      if (!isValidCombo(combo)) continue;

      const results = bidders
        .map((b) => ({ name: b.name, total: calcTotal(b, combo) }))
        .sort((a, b) => a.total - b.total);

      const label =
        combo.length === 0
          ? "Base Bid Only"
          : "Base + " + combo.map((c) => labelFor(c)).join(", ");

      combos.push({
        alternates: label,
        alternateIndices: combo,
        winner: results[0],
        allBids: results,
      });
    }

    return combos.sort((a, b) => a.winner.total - b.winner.total);
  };

  const currentTotals = useMemo(
    () =>
      [...bidders]
        .map((b) => ({ ...b, total: calcTotal(b, selectedAlternates) }))
        .sort((a, b) => a.total - b.total),
    [bidders, selectedAlternates]
  );

  const allCombinations = useMemo(
    () => getAllCombinations(),
    [bidders, numAlternates, has2A, xor34, altLabels, alt2ALabel]
  );

  // Apply budget cap (filter by winning total)
  const filteredCombinations = useMemo(() => {
    const cap = typeof budgetCap === "number" ? budgetCap : undefined;
    if (cap && cap > 0)
      return allCombinations.filter((c) => c.winner.total <= cap);
    return allCombinations;
  }, [allCombinations, budgetCap]);

  const contractorWinningCombos = useMemo(
    () =>
      selectedContractor
        ? filteredCombinations.filter(
            (c) => c.winner.name === selectedContractor
          )
        : [],
    [filteredCombinations, selectedContractor]
  );

  // Winning percentage per contractor (across filtered combos)
  const winningStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bidders) counts.set(b.name, 0);
    for (const combo of filteredCombinations)
      counts.set(combo.winner.name, (counts.get(combo.winner.name) || 0) + 1);
    const total = filteredCombinations.length || 1;
    return [...counts.entries()]
      .map(([name, wins]) => ({ name, wins, pct: (wins / total) * 100 }))
      .sort((a, b) => b.pct - a.pct);
  }, [bidders, filteredCombinations]);

  // Budget Frontier: best (lowest total) scenario for each k = # of alternates selected
  const budgetFrontier = useMemo(() => {
    const bestByK = new Map<number, ComboResult>();
    for (const c of filteredCombinations) {
      const k = c.alternateIndices.length;
      const prev = bestByK.get(k);
      if (!prev || c.winner.total < prev.winner.total) bestByK.set(k, c);
    }
    return [...bestByK.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, combo]) => ({ k, combo }));
  }, [filteredCombinations]);

  // --------- export (analysis CSV) ---------
  const exportToCSV = () => {
    const headers = [
      "Base Bid & Alternate Combination",
      "Winning Contractor",
      "Total Dollar Amount",
      "Difference from Next Lowest",
    ];
    const rows = filteredCombinations.map((c) => {
      const winner = c.allBids[0];
      const next = c.allBids[1];
      return [
        c.alternates,
        winner.name,
        winner.total,
        next ? next.total - winner.total : 0,
      ];
    });
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${cell}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bid_analysis.csv";
    a.click();
  };

  // --------- UI ---------
  return (
    <div className="min-h-screen bg-blue-200 flex flex-col">
      {/* Header bar */}
      <div className="bg-blue-300 text-blue-900 py-4 shadow-md">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Company Logo"
              className="h-16 md:h-20 w-auto rounded-md"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Construction BidAnalyzer
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={resetData}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white shadow-sm hover:bg-red-700 transition-all"
              title="Reset to defaults"
            >
              <RefreshCw className="w-4 h-4" /> Refresh Data
            </button>
            <button
              onClick={exportSnapshot}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-200 text-stone-800 hover:bg-stone-300"
              title="Save snapshot (.json)"
            >
              <Save className="w-4 h-4" /> Save
            </button>
            <button
              onClick={() => snapshotInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-200 text-stone-800 hover:bg-stone-300"
              title="Load snapshot (.json)"
            >
              <FolderOpen className="w-4 h-4" /> Load
            </button>
            <input
              ref={snapshotInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={importSnapshot}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto p-6 space-y-6 w-full">
        {/* Controls Card */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <p className="text-sm text-stone-600 italic mt-2">
            <em>
              Ownership Tool for Comparing All Possible Winning Combinations
              Instantly!
            </em>
          </p>

          <div className="mt-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <label
                htmlFor="numAlts"
                className="text-[15px] font-medium text-stone-800"
              >
                Number of Alternates:
              </label>
              <select
                id="numAlts"
                value={numAlternates}
                onChange={(e) => updateNumAlternates(parseInt(e.target.value))}
                className="border border-stone-300 rounded-xl px-3 py-2 bg-white text-stone-800 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>2A</option>
                <option value={4}>3</option>
                <option value={5}>4</option>
                <option value={6}>5</option>
                <option value={7}>6</option>
                <option value={8}>7</option>
                <option value={9}>8</option>
                <option value={10}>9</option>
                <option value={11}>10</option>
                <option value={12}>11</option>
                <option value={13}>12</option>
              </select>
            </div>

            <button
              onClick={exportToCSV}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 text-white shadow-sm hover:bg-amber-700 transition-all"
            >
              💾 Export to CSV
            </button>

            {/* Template + Import adjacent */}
            <button
              onClick={downloadTemplateCSV}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-stone-200 text-stone-800 hover:bg-stone-300"
              title="Download CSV template"
            >
              <FileDown className="w-4 h-4" /> Template
            </button>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-700 text-white font-bold shadow-sm hover:bg-gray-800 cursor-pointer">
              <Upload className="w-4 h-4 text-white" />
              <span className="text-sm">Import Excel/CSV</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImport}
              />
            </label>
          </div>
        </div>

        {/* Data Entry Card (scrollable + collapsible) */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold text-stone-800">Data Entry</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={addBidder}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 text-white shadow-sm hover:bg-teal-700 transition-all"
              >
                ➕ Add Bidder
              </button>
              <button
                onClick={() => setDataEntryOpen((v) => !v)}
                className="text-sm text-stone-700 hover:text-stone-900"
              >
                {dataEntryOpen ? "Collapse ▾" : "Expand ▸"}
              </button>
            </div>
          </div>

          {dataEntryOpen && (
            <div className="overflow-auto max-h-[520px] rounded-xl border border-stone-200">
              <table className="w-full min-w-[1100px]">
                <thead className="bg-stone-50 sticky top-0 z-10">
                  <tr className="text-left text-stone-700">
                    <th className="px-4 py-2 border-b border-stone-200 min-w-[14rem]">
                      Contractor
                    </th>
                    <th className="px-4 py-2 border-b border-stone-200 min-w-[9rem]">
                      Base Bid ($)
                    </th>
                    {Array.from({ length: numAlternates }, (_, idx) => (
                      <th
                        key={idx}
                        className="px-4 py-2 border-b border-stone-200 min-w-[8rem]"
                      >
                        {altLabels[idx] ?? `Alt ${idx + 1}`}
                        <div className="text-xs text-stone-500 italic">($)</div>
                      </th>
                    ))}
                    {has2A && (
                      <th className="px-4 py-2 border-b border-stone-200 min-w-[8rem]">
                        {alt2ALabel}
                        <div className="text-xs text-stone-500 italic">($)</div>
                      </th>
                    )}
                    <th className="px-4 py-2 border-b border-stone-200 min-w-[6rem]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="[&>tr:nth-child(even)]:bg-stone-50/60">
                  {bidders.map((b) => (
                    <tr
                      key={b.id}
                      className="hover:bg-amber-50/40 transition-colors"
                    >
                      <td className="px-4 py-2 border-b border-stone-100">
                        <input
                          type="text"
                          value={b.name}
                          onChange={(e) =>
                            updateBidder(b.id, "name", e.target.value)
                          }
                          className="w-full px-3 py-2 text-[15px] rounded-xl border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
                        />
                      </td>
                      <td className="px-4 py-2 border-b border-stone-100">
                        <input
                          type="number"
                          value={b.baseBid}
                          onChange={(e) =>
                            updateBidder(
                              b.id,
                              "baseBid",
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="w-full px-3 py-2 text-[15px] rounded-xl border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
                        />
                      </td>
                      {Array.from({ length: numAlternates }, (_, idx) => (
                        <td
                          key={idx}
                          className="px-4 py-2 border-b border-stone-100"
                        >
                          <input
                            type="number"
                            value={b.alternates[idx] || 0}
                            onChange={(e) =>
                              updateAlternate(b.id, idx, e.target.value)
                            }
                            className="w-full px-3 py-2 text-[15px] rounded-xl border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
                          />
                        </td>
                      ))}
                      {has2A && (
                        <td className="px-4 py-2 border-b border-stone-100">
                          <input
                            type="number"
                            value={b.alternate2A || 0}
                            onChange={(e) =>
                              updateAlternate2A(b.id, e.target.value)
                            }
                            className="w-full px-3 py-2 text-[15px] rounded-xl border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
                          />
                        </td>
                      )}
                      <td className="px-4 py-2 border-b border-stone-100 text-center">
                        <button
                          onClick={() => removeBidder(b.id)}
                          className="text-red-500 hover:text-red-700 text-lg"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Winning Percentages Card */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-xl font-semibold text-stone-800 mb-3">
            Winning Percentage by Contractor
          </h2>
          {winningStats.length === 0 ? (
            <div className="text-stone-700 italic">No scenarios available.</div>
          ) : (
            <div className="space-y-2">
              {winningStats.map(({ name, pct, wins }) => (
                <div key={name} className="flex items-center gap-3">
                  <div className="w-40 text-sm text-stone-800">{name}</div>
                  <div className="flex-1 bg-stone-100 rounded-full overflow-hidden h-3">
                    <div
                      className="bg-emerald-500 h-3"
                      style={{ width: `${pct.toFixed(1)}%` }}
                    />
                  </div>
                  <div className="w-28 text-right text-sm text-stone-700">
                    {pct.toFixed(1)}% ({wins})
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-stone-500 mt-2">
            Based on all valid combinations after applying your budget cap (if
            any).
          </p>
        </div>

        {/* Current Selection Card */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-stone-800">
              Current Selection
            </h2>
            <button
              onClick={() => setSelectedAlternates([])}
              className="text-sm text-stone-700 hover:text-stone-900"
              title="Clear all selected alternates"
            >
              Clear all
            </button>
          </div>

          <div className="mb-4">
            <p className="text-[15px] font-medium text-stone-800 mb-2">
              Select Alternates to Include:
            </p>
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: numAlternates }, (_, idx) => {
                const checked = selectedAlternates.includes(idx);
                const disabled34 =
                  xor34 &&
                  numAlternates >= 4 &&
                  ((idx === 2 && selectedAlternates.includes(3)) ||
                    (idx === 3 && selectedAlternates.includes(2)));
                return (
                  <label
                    key={idx}
                    className={`flex items-center gap-3 cursor-pointer py-1.5 px-2 rounded-lg ${
                      disabled34 ? "opacity-60" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAlternate(idx)}
                      className="rounded"
                      disabled={disabled34 && !checked}
                    />
                    <span className="text-stone-800">
                      {altLabels[idx] ?? `Alt ${idx + 1}`}
                    </span>
                  </label>
                );
              })}
              {has2A && (
                <label
                  className={`flex items-center gap-3 cursor-pointer py-1.5 px-2 rounded-lg ${
                    selectedAlternates.includes(1) ? "opacity-60" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedAlternates.includes("alt2A")}
                    onChange={() => toggleAlternate("alt2A")}
                    className="rounded"
                  />
                  <span className="text-stone-800">{alt2ALabel}</span>
                </label>
              )}
            </div>
            <p className="text-xs text-stone-500 italic mt-2">
              Totals update live as you toggle alternates.
            </p>
          </div>

          <div className="space-y-2">
            {currentTotals.map((b: any, i) => (
              <div
                key={b.id}
                className={`p-3 rounded-xl border-l-4 ${
                  i === 0
                    ? "bg-emerald-50 border-emerald-500"
                    : "bg-stone-50 border-stone-300"
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium text-stone-800">
                    {i === 0 && (
                      <span className="text-emerald-600 mr-2">🏆</span>
                    )}
                    {b.name}
                  </span>
                  <span className="text-lg font-semibold text-stone-900">
                    {fmt$(b.total as number)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Contractor-Specific Card (only show lowest 2 bids per scenario) */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-xl font-semibold text-stone-800 mb-4">
            Contractor-Specific Winning Combinations (Top 2 bids per scenario)
          </h2>

          <div className="mb-4">
            <label
              htmlFor="contractorSel"
              className="text-[15px] font-medium text-stone-800 mr-3"
            >
              Select Contractor:
            </label>
            <select
              id="contractorSel"
              value={selectedContractor}
              onChange={(e) => setSelectedContractor(e.target.value)}
              className="border border-stone-300 rounded-xl px-3 py-2 bg-white text-stone-800 focus:ring-2 focus:ring-teal-200 focus:border-teal-400 min-w-[12rem]"
            >
              <option value="">-- Choose a contractor --</option>
              {bidders.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-stone-500 italic mt-2">
              Shows only the lowest two bids for each scenario (after budget
              filtering).
            </p>
          </div>

          {selectedContractor && (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {contractorWinningCombos.length === 0 ? (
                <div className="text-stone-700 italic p-4 bg-stone-50 border border-stone-200 rounded-2xl text-center">
                  {selectedContractor} is not the lowest bidder in any scenario.
                </div>
              ) : (
                contractorWinningCombos.map((combo, index) => (
                  <div
                    key={index}
                    className="border border-stone-200 rounded-xl p-3"
                  >
                    <div className="font-medium text-stone-700 mb-2">
                      {combo.alternates}
                    </div>
                    {combo.allBids.slice(0, 2).map((bid, idx) => (
                      <div
                        key={idx}
                        className={`${
                          idx === 0
                            ? "bg-emerald-50 border-l-4 border-emerald-500"
                            : "bg-stone-50 border-l-4 border-stone-300"
                        } p-2 rounded mt-1`}
                      >
                        <div className="flex justify-between items-center text-sm">
                          <span
                            className={`font-medium ${
                              idx === 0 ? "text-emerald-800" : "text-stone-700"
                            }`}
                          >
                            {idx === 0 && <span className="mr-1">🏆</span>}
                            {bid.name}
                          </span>
                          <span
                            className={
                              idx === 0
                                ? "text-emerald-800 font-semibold"
                                : "text-stone-700"
                            }
                          >
                            {fmt$(bid.total)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Top Combinations Card (collapsible) */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-stone-800">
              Top Combinations
            </h2>
            <button
              onClick={() => setTopCombosOpen((v) => !v)}
              className="text-sm text-stone-700 hover:text-stone-900"
            >
              {topCombosOpen ? "Collapse ▾" : "Expand ▸"}
            </button>
          </div>

          {topCombosOpen && (
            <>
              {filteredCombinations.length === 0 ? (
                <div className="text-stone-700 italic">
                  No combinations found. Adjust budget or data.
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {filteredCombinations.slice(0, topN).map((c, i) => (
                    <div
                      key={i}
                      className="border border-stone-200 rounded-2xl p-3"
                    >
                      <div className="font-medium text-stone-700 mb-1">
                        {c.alternates}
                      </div>
                      <div className="bg-emerald-50 p-2 rounded border-l-4 border-emerald-500">
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-emerald-800">
                            <span className="mr-1">🏆</span>
                            {c.winner.name}
                          </span>
                          <span className="font-bold text-emerald-800">
                            {fmt$(c.winner.total)}
                          </span>
                        </div>
                      </div>
                      {c.allBids[1] && (
                        <div className="bg-stone-50 p-2 rounded mt-1">
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-stone-700">
                              Next: {c.allBids[1].name}
                            </span>
                            <span className="text-stone-700">
                              {fmt$(c.allBids[1].total)} (+
                              {fmt$(c.allBids[1].total - c.winner.total)})
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Budget Frontier Card (collapsible - consistent style) */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold text-stone-800">
              Budget Frontier
            </h2>
            <button
              onClick={() => setFrontierOpen((v) => !v)}
              className="text-sm text-stone-700 hover:text-stone-900"
            >
              {frontierOpen ? "Collapse ▾" : "Expand ▸"}
            </button>
          </div>

          {frontierOpen && (
            <>
              <p className="text-xs text-stone-500 mb-3">
                Best (lowest total) winning scenario for each number of
                alternates selected. Helps compare scope size vs. cost.
              </p>
              {budgetFrontier.length === 0 ? (
                <div className="text-stone-700 italic">
                  No scenarios available.
                </div>
              ) : (
                <div className="space-y-2">
                  {budgetFrontier.map(({ k, combo }) => (
                    <div
                      key={k}
                      className="p-3 rounded-xl border border-stone-200 bg-stone-50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-stone-800 font-medium">
                          k = {k}
                        </div>
                        <div className="text-stone-700">{combo.alternates}</div>
                        <div className="text-stone-900 font-semibold">
                          {combo.winner.name} · {fmt$(combo.winner.total)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Alternate Labels & Budget Card — whole card collapsible */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold text-stone-800">
              Alternate Labels & Budget
            </h2>
            <button
              onClick={() => setLabelsOpen((v) => !v)}
              className="text-sm text-stone-700 hover:text-stone-900"
            >
              {labelsOpen ? "Collapse ▾" : "Expand ▸"}
            </button>
          </div>

          {labelsOpen && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-stone-700 mb-2">
                  Alternate Labels
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: numAlternates }, (_, idx) => (
                    <input
                      key={idx}
                      type="text"
                      value={altLabels[idx] ?? `Alt ${idx + 1}`}
                      onChange={(e) =>
                        setAltLabels((prev) => {
                          const next = [...prev];
                          next[idx] = e.target.value;
                          return next;
                        })
                      }
                      className="px-2 py-1 rounded-lg border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
                      placeholder={`Alt ${idx + 1}`}
                    />
                  ))}
                  {has2A && (
                    <input
                      type="text"
                      value={alt2ALabel}
                      onChange={(e) => setAlt2ALabel(e.target.value)}
                      className="px-2 py-1 rounded-lg border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400 col-span-2"
                      placeholder="Alt 2A"
                    />
                  )}
                </div>
              </div>

              {/* Advanced collapsible inside the card (Budget + Top N) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-stone-700">
                    Advanced
                  </div>
                  <button
                    onClick={() => setIsAdvancedOpen((v) => !v)}
                    className="text-xs text-stone-700 hover:text-stone-900"
                  >
                    {isAdvancedOpen ? "Hide ▾" : "Show ▸"}
                  </button>
                </div>
                {isAdvancedOpen && (
                  <div className="space-y-3">
                    <div>
                      <div className="text-sm font-medium text-stone-700 mb-2">
                        Owner Budget Cap ($)
                      </div>
                      <input
                        type="number"
                        value={budgetCap}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBudgetCap(v === "" ? "" : parseFloat(v) || 0);
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
                        placeholder="Leave blank for no cap"
                      />
                      <div className="text-xs text-stone-500 mt-1">
                        Filtering applies to Top Combinations, Winning %,
                        Frontier, and contractor scenarios.
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm font-medium text-stone-700">
                        Show Top N combinations:
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={topN}
                        onChange={(e) =>
                          setTopN(
                            Math.max(
                              1,
                              Math.min(100, parseInt(e.target.value) || 1)
                            )
                          )
                        }
                        className="w-24 px-2 py-1 rounded-lg border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer bar */}
      <div className="bg-blue-300 text-blue-900 py-3 mt-6">
        <div className="max-w-7xl mx-auto px-6 text-sm">
          © 2025 Bid Analyzer
        </div>
      </div>
    </div>
  );
}
