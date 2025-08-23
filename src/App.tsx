import React from 'react'
import { Upload } from 'lucide-react'

export default function App() {
  return (
    <div className="min-h-screen bg-blue-200 flex items-center justify-center p-10">
      <div className="bg-white rounded-2xl shadow p-6 max-w-xl w-full text-center space-y-4">
        <h1 className="text-2xl font-semibold text-stone-900">BidAnalyzer (Fresh Start)</h1>
        <p className="text-stone-600">
          Your Vite + React + TypeScript + Tailwind app is running.
        </p>
        <p className="text-stone-700 text-sm">
          Replace <code>src/App.tsx</code> with your Bid Analyzer component when ready.
        </p>
        <div className="inline-flex items-center gap-2 text-stone-800">
          <Upload className="w-5 h-5" /> Example icon from lucide-react
        </div>
      </div>
    </div>
  )
}