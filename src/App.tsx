// BidAnalyzer_2025-08-22_full_exclusions.tsx
// Requires Tailwind CSS and:
//   npm i xlsx lucide-react

import React, { useMemo, useState } from "react";
import { Upload } from "lucide-react";
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
  allBids: { name: string; total: number }[];
};

const fmtCurrency = (n: number) =>
  String.fromCharCode(36) +
  (Number(n) || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });

function enforceSelectionXOR(
  selection: AltIndex[],
  rules: Array<[AltIndex, AltIndex]>
) {
  const set = new Set<AltIndex>(selection);
  for (const [a, b] of rules) {
    if (set.has(a) && set.has(b)) {
      set.delete(b);
    }
  }
  return Array.from(set);
}

export default function BidAnalyzer() {
  // Config / toggles
  const [numAlternates, setNumAlternates] = useState<number>(2);
  const [has2A, setHas2A] = useState<boolean>(false); // default unchecked on load
  const [xor34, setXor34] = useState<boolean>(false); // optional Alt3 vs Alt4

  // Data
  const [bidders, setBidders] = useState<Bidder[]>([
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
  ]);

  // UI state
  const [selectedAlternates, setSelectedAlternates] = useState<AltIndex[]>([]);
  const [selectedContractor, setSelectedContractor] = useState<string>("");

  // EXCLUSIONS for win-rate stats only (does NOT affect calculator)
  const [excludedStats, setExcludedStats] = useState<AltIndex[]>([]);
  const toggleExclude = (idx: AltIndex) =>
    setExcludedStats((prev) =>
      prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]
    );

  // XOR rules
  const xorRules = useMemo<Array<[AltIndex, AltIndex]>>(() => {
    const rules: Array<[AltIndex, AltIndex]> = [];
    if (has2A) rules.push([1, "alt2A"]); // Alt 2 (index 1) XOR Alt 2A
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

      // enforce XOR locally
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
      typeof v === "string" ? Number(v.replace(/[\$,\s]/g, "")) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const normalizeRow = (obj: Record<string, any>): Omit<Bidder, "id"> => {
    // Accept headers like Contractor/Name, Base/Base Bid, Alt1..AltN, Alt 2A / Alt2A
    const name: string =
      obj.Contractor || obj.Name || obj["Contractor Name"] || "";
    const base = coerceNumber(
      obj.Base ?? obj["Base Bid"] ?? obj["Base (USD)"] ?? 0
    );

    const altEntries = Object.entries(obj)
      .filter(([k]) => /^Alt\s*\d+$/i.test(k))
      .sort(
        (a, b) =>
          Number(a[0].match(/\d+/)?.[0] || 0) -
          Number(b[0].match(/\d+/)?.[0] || 0)
      );

    const alternates = altEntries.map(([, v]) => coerceNumber(v));
    const alt2a = coerceNumber(
      obj["Alt 2A"] ?? obj["Alt2A"] ?? obj["Alternate 2A"] ?? 0
    );

    return { name, baseBid: base, alternates, alternate2A: alt2a };
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
          const maxAlts = Math.max(
            0,
            ...normalized.map((r) => r.alternates.length)
          );
          setNumAlternates(maxAlts);
          setBidders(
            normalized.map((r, idx) => ({
              id: idx + 1,
              name: r.name,
              baseBid: r.baseBid,
              alternates: Array.from(
                { length: maxAlts },
                (_, i) => r.alternates[i] ?? 0
              ),
              alternate2A: r.alternate2A ?? 0,
            }))
          );
          setSelectedAlternates([]);
        } else if (ext === "csv") {
          // lightweight CSV (no quoted commas). For robust CSV, use PapaParse.
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
          const maxAlts = Math.max(
            0,
            ...normalized.map((r) => r.alternates.length)
          );
          setNumAlternates(maxAlts);
          setBidders(
            normalized.map((r, idx) => ({
              id: idx + 1,
              name: r.name,
              baseBid: r.baseBid,
              alternates: Array.from(
                { length: maxAlts },
                (_, i) => r.alternates[i] ?? 0
              ),
              alternate2A: r.alternate2A ?? 0,
            }))
          );
          setSelectedAlternates([]);
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
          : "Base + " +
            combo
              .map((c) => (c === "alt2A" ? "Alt 2A" : `Alt ${Number(c) + 1}`))
              .join(", ");

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
    [bidders, numAlternates, has2A, xor34]
  );

  const contractorWinningCombos = useMemo(
    () =>
      selectedContractor
        ? allCombinations.filter((c) => c.winner.name === selectedContractor)
        : [],
    [allCombinations, selectedContractor]
  );

  // Win-rate stats with optional exclusions (for stats only)
  const filteredCombinationsForStats = useMemo(
    () =>
      allCombinations.filter((c) =>
        c.alternateIndices.every((ai) => !excludedStats.includes(ai))
      ),
    [allCombinations, excludedStats]
  );

  const winStats = useMemo(() => {
    const total = filteredCombinationsForStats.length;
    const counts = new Map<string, number>();
    filteredCombinationsForStats.forEach((c) => {
      counts.set(c.winner.name, (counts.get(c.winner.name) || 0) + 1);
    });
    const rows = bidders
      .map((b) => {
        const wins = counts.get(b.name) || 0;
        const pct = total ? (wins / total) * 100 : 0;
        return { name: b.name, wins, pct };
      })
      .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
    return { total, rows };
  }, [filteredCombinationsForStats, bidders]);

  // --------- export ---------
  const exportToCSV = () => {
    const headers = [
      "Base Bid & Alternate Combination",
      "Winning Contractor",
      "Total Dollar Amount",
      "Difference from Next Lowest",
    ];
    const rows = allCombinations.map((c) => {
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
        <div className="max-w-7xl mx-auto px-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            Construction Bid Analyzer
          </h1>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto p-6 space-y-6 w-full">
        {/* Controls Card */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <p className="text-sm text-stone-600">
            Compare base bids and alternates with clear, warm visuals.
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
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-[15px] font-medium text-stone-800">
              <input
                type="checkbox"
                className="mr-1"
                checked={has2A}
                onChange={toggleHas2A}
              />
              Include Alt 2A (mutually exclusive with Alt 2)
            </label>

            <label className="flex items-center gap-2 text-[15px] font-medium text-stone-800">
              <input
                type="checkbox"
                className="mr-1"
                checked={xor34}
                onChange={() => {
                  setXor34((v) => !v);
                  setSelectedAlternates((prev) =>
                    enforceSelectionXOR(prev, [[2, 3]])
                  );
                }}
                disabled={numAlternates < 4}
              />
              Alt 3 ⊻ Alt 4 (at most one)
            </label>

            <button
              onClick={addBidder}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 text-white shadow-sm hover:bg-teal-700 transition-all"
            >
              ➕ Add Bidder
            </button>

            <button
              onClick={exportToCSV}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 text-white shadow-sm hover:bg-amber-700 transition-all"
            >
              💾 Export to CSV
            </button>

            {/* Dark grey, bold import button */}
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

        {/* Win Percentage Card */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-xl font-semibold text-stone-800 mb-2">
            Win rates across all valid combinations
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-stone-700">Exclude from stats:</span>
            {Array.from({ length: numAlternates }, (_, idx) => (
              <label key={idx} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={excludedStats.includes(idx)}
                  onChange={() => toggleExclude(idx)}
                />
                <span className="text-stone-800">Alt {idx + 1}</span>
              </label>
            ))}
            {has2A && (
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={excludedStats.includes("alt2A")}
                  onChange={() => toggleExclude("alt2A")}
                />
                <span className="text-stone-800">Alt 2A</span>
              </label>
            )}
            {excludedStats.length > 0 && (
              <button
                onClick={() => setExcludedStats([])}
                className="ml-auto px-3 py-1 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50"
              >
                Clear exclusions
              </button>
            )}
          </div>
          <p className="text-sm text-stone-600 mt-2">
            Based on {winStats.total} scenario{winStats.total === 1 ? "" : "s"}
            {excludedStats.length > 0 ? " after exclusions" : ""}.
          </p>

          {winStats.total === 0 ? (
            <div className="mt-4 p-3 bg-stone-50 border border-stone-200 rounded-xl text-stone-700 text-sm">
              No scenarios left with the current exclusions.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {winStats.rows.map((r) => (
                <div key={r.name} className="flex items-center gap-4">
                  <div className="w-40 font-medium text-stone-800 truncate">
                    {r.name}
                  </div>
                  <div className="flex-1">
                    <div className="h-3 bg-stone-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${Math.round(r.pct)}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-36 text-right text-stone-700 text-sm">
                    {r.wins}/{winStats.total} ({Math.round(r.pct)}%)
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bidder Input Table Card */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-4">
          <div className="overflow-x-auto">
            <table className="w-full border border-stone-200 rounded-xl overflow-hidden">
              <thead className="bg-stone-50 sticky top-0 z-10">
                <tr className="text-left text-stone-700">
                  <th className="px-4 py-2 border-b border-stone-200">
                    Contractor
                  </th>
                  <th className="px-4 py-2 border-b border-stone-200">
                    Base Bid (USD)
                  </th>
                  {Array.from({ length: numAlternates }, (_, idx) => (
                    <th
                      key={idx}
                      className="px-4 py-2 border-b border-stone-200"
                    >
                      Alt {idx + 1}
                      <div className="text-xs text-stone-500 italic">(USD)</div>
                    </th>
                  ))}
                  {has2A && (
                    <th className="px-4 py-2 border-b border-stone-200">
                      Alt 2A
                      <div className="text-xs text-stone-500 italic">(USD)</div>
                    </th>
                  )}
                  <th className="px-4 py-2 border-b border-stone-200">
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
                        className="w-full px-2 py-1 rounded-lg border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
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
                        className="w-full px-2 py-1 rounded-lg border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
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
                          className="w-full px-2 py-1 rounded-lg border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
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
                          className="w-full px-2 py-1 rounded-lg border border-stone-300 focus:ring-2 focus:ring-teal-200 focus:border-teal-400"
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
        </div>

        {/* Current Selection Card */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-xl font-semibold text-stone-800 mb-4">
            Current Selection
          </h2>

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
                    <span className="text-stone-800">Alt {idx + 1}</span>
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
                    disabled={
                      selectedAlternates.includes(1) &&
                      !selectedAlternates.includes("alt2A")
                    }
                  />
                  <span className="text-stone-800">Alt 2A</span>
                </label>
              )}
            </div>
            <p className="text-xs text-stone-500 italic mt-2">
              Totals update live as you toggle alternates.
            </p>
          </div>

          <div className="space-y-2">
            {currentTotals.map((b, i) => (
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
                    {fmtCurrency(b.total)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Contractor-Specific Card */}
        <div className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-xl font-semibold text-stone-800 mb-4">
            Contractor-Specific Winning Combinations
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
              View only the scenarios where the selected contractor is the low
              bidder.
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
                    <div className="bg-emerald-50 p-2 rounded border-l-4 border-emerald-500">
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-emerald-800">
                          <span className="mr-1">🏆</span>
                          {combo.winner.name}
                        </span>
                        <span className="text-emerald-800 font-bold flex items-center gap-3">
                          {fmtCurrency(combo.winner.total)}
                          {combo.allBids[1] && (
                            <span className="text-xs font-medium text-emerald-900/80">
                              +
                              {fmtCurrency(
                                combo.allBids[1].total - combo.winner.total
                              )}{" "}
                              vs next
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    {/* Only show the second-lowest bid */}
                    {combo.allBids.slice(1, 2).map((bid, bidIndex) => (
                      <div
                        key={bidIndex}
                        className="bg-stone-50 p-2 rounded mt-1"
                      >
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-stone-700">{bid.name}</span>
                          <span className="text-stone-700">
                            {fmtCurrency(bid.total)}
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
