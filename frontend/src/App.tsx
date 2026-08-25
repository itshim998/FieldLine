import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, 
  Database, 
  Server, 
  Layers, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Cpu, 
  Terminal, 
  ShieldCheck,
  FolderGit2
} from 'lucide-react';

interface HealthData {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  environment: string;
  database: {
    status: 'connected' | 'disconnected' | 'error';
    type: string;
    path: string;
  };
  metadata?: Record<string, string>;
}

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      const end = performance.now();
      
      if (!res.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`);
      }
      
      setHealth(data);
      setLatency(Math.round(end - start));
      setError(null);
      setLastChecked(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to connect to backend server');
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const isOnline = health?.status === 'ok';

  return (
    <div className="container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="logo-badge">
            <Layers size={26} color="#ffffff" />
          </div>
          <div>
            <h1 className="brand-title">FieldLine</h1>
            <p className="brand-tagline">
              Intelligent Data Capture & Schedule-Linking Layer for Infrastructure Project Management
            </p>
          </div>
        </div>
        <div className="badge-sih">
          <ShieldCheck size={15} />
          SIH 2026 &bull; PS ID: SIH26122
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Backend & Health Card */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-icon">
                <Server size={20} />
              </div>
              <h2 className="card-title">Backend Status</h2>
            </div>
            <div className={`status-pill ${isOnline ? 'online' : 'offline'}`}>
              <div className="pulse-dot" />
              {isOnline ? 'Active' : 'Offline'}
            </div>
          </div>

          <div className="info-list">
            <div className="info-item">
              <span className="info-key">Service</span>
              <span className="info-val">{health?.service || 'FieldLine Express Monolith'}</span>
            </div>
            <div className="info-item">
              <span className="info-key">Version</span>
              <span className="info-val">{health?.version || '0.1.0 (Pass 1)'}</span>
            </div>
            <div className="info-item">
              <span className="info-key">Environment</span>
              <span className="info-val">{health?.environment || 'development'}</span>
            </div>
            <div className="info-item">
              <span className="info-key">API Latency</span>
              <span className="info-val">{latency !== null ? `${latency} ms` : '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-key">Last Checked</span>
              <span className="info-val">{lastChecked ? lastChecked.toLocaleTimeString() : '—'}</span>
            </div>
            {error && (
              <div className="info-item" style={{ borderLeft: '3px solid var(--accent-rose)', color: '#fb7185' }}>
                <span className="info-key" style={{ color: '#fb7185' }}>Error</span>
                <span className="info-val">{error}</span>
              </div>
            )}
          </div>

          <div className="actions-group">
            <button 
              id="refresh-btn"
              className="btn btn-primary" 
              onClick={fetchHealth} 
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? 'pulse-dot' : ''} />
              {loading ? 'Checking...' : 'Refresh Status'}
            </button>
          </div>
        </div>

        {/* Database Status Card */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-icon">
                <Database size={20} />
              </div>
              <h2 className="card-title">Local Persistence</h2>
            </div>
            <div className={`status-pill ${health?.database.status === 'connected' ? 'online' : 'offline'}`}>
              <div className="pulse-dot" />
              {health?.database.status === 'connected' ? 'SQLite Ready' : 'Unavailable'}
            </div>
          </div>

          <div className="info-list">
            <div className="info-item">
              <span className="info-key">Engine</span>
              <span className="info-val">SQLite (Local WAL Mode)</span>
            </div>
            <div className="info-item">
              <span className="info-key">Database Path</span>
              <span className="info-val">{health?.database.path || './database/fieldline.db'}</span>
            </div>
            <div className="info-item">
              <span className="info-key">Schema Version</span>
              <span className="info-val">{health?.metadata?.schema_version || '0.1.0'}</span>
            </div>
            <div className="info-item">
              <span className="info-key">Current Pass</span>
              <span className="info-val">{health?.metadata?.pass || 'Pass 0: Bootstrap'}</span>
            </div>
            <div className="info-item">
              <span className="info-key">SIH Reference</span>
              <span className="info-val">{health?.metadata?.sih_ps_id || 'SIH26122'}</span>
            </div>
          </div>

          <div className="actions-group">
            <a 
              href="/api/health" 
              target="_blank" 
              rel="noreferrer"
              className="btn btn-secondary"
              style={{ textDecoration: 'none' }}
            >
              <Terminal size={16} />
              Raw Health JSON
            </a>
          </div>
        </div>

        {/* Architecture & Boundaries Card */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-icon">
                <Cpu size={20} />
              </div>
              <h2 className="card-title">Architecture: Local Modular Monolith</h2>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Presentation-grade local infrastructure
            </span>
          </div>

          <div className="arch-flow">
            <div className="arch-node active">
              <span className="arch-number">1</span>
              <span className="arch-label">Vite + React Frontend Shell</span>
              <span className="arch-sub">Local Browser Port 3000</span>
            </div>
            <div className="arch-node active">
              <span className="arch-number">2</span>
              <span className="arch-label">Express Monolith API Layer</span>
              <span className="arch-sub">Local Node.js Port 3001 &bull; /api/health</span>
            </div>
            <div className="arch-node">
              <span className="arch-number">3</span>
              <span className="arch-label">Domain Services & AI Layer</span>
              <span className="arch-sub">Zod Validation &bull; Reserved for Passes 1-6</span>
            </div>
            <div className="arch-node active">
              <span className="arch-number">4</span>
              <span className="arch-label">SQLite Local Database & Uploads Storage</span>
              <span className="arch-sub">database/fieldline.db &bull; uploads/</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Banner */}
      <footer className="footer-banner">
        <div className="footer-text">
          <strong>FieldLine Pass 1 Complete</strong> &bull; Clean application architecture and module boundaries established.
        </div>
        <div className="footer-actions">
          <span className="footer-link">npm run dev</span>
          <span className="footer-link">npm test</span>
          <span className="footer-link">npm run setup</span>
        </div>
      </footer>
    </div>
  );
}
export default App;
