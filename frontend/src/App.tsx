
function App() {
  return (
    <div className="min-height-screen bg-dark-900 text-white flex flex-col items-center justify-center p-6">
      <div className="glass-panel p-8 rounded-2xl max-w-md w-full text-center shadow-2xl">
        <div className="flex justify-center mb-4">
          <span className="text-5xl animate-pulse">📡</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
          Uptime Monitor
        </h1>
        <p className="mt-4 text-gray-400 text-sm">
          A sleek, private, self-hosted web application to monitor all your endpoints. Real-time metrics coming soon.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-widest">
            System Operational
          </span>
        </div>
      </div>
    </div>
  );
}

export default App;
