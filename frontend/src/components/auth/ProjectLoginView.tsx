import React, { useState, useEffect, useId } from 'react';
import {
  ShieldCheck,
  User,
  Lock,
  Sparkles,
  ArrowRight,
  RefreshCw,
  FolderGit2,
  AlertCircle,
  CheckCircle2,
  KeyRound
} from 'lucide-react';
import { useAuth, AccountType } from '../../context/AuthContext.js';

export interface ProjectSummary {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  status?: string;
}

export interface ProjectLoginViewProps {
  projects: ProjectSummary[];
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string) => void;
  onLoginSuccess: (role: AccountType, projectId: string) => void;
  onCancel?: () => void;
  onSeedGoldenDemo?: () => void;
  isSeedingDemo?: boolean;
}

export function ProjectLoginView({
  projects,
  selectedProjectId,
  onSelectProject,
  onLoginSuccess,
  onCancel,
  onSeedGoldenDemo,
  isSeedingDemo
}: ProjectLoginViewProps): React.JSX.Element {
  const { login, isLoading } = useAuth();

  // Find or default selected project
  const [projectId, setProjectId] = useState<string>(() => {
    if (selectedProjectId) return selectedProjectId;
    const golden = projects.find((p) => p.code === 'REFINERY-U4');
    return golden ? golden.id : projects[0]?.id || '';
  });

  const [accountType, setAccountType] = useState<AccountType>('worker');
  const [passcode, setPasscode] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const projectSelectId = useId();
  const passcodeFieldId = useId();

  useEffect(() => {
    if (selectedProjectId) {
      setProjectId(selectedProjectId);
    } else if (!projectId && projects.length > 0) {
      const golden = projects.find((p) => p.code === 'REFINERY-U4');
      setProjectId(golden ? golden.id : projects[0].id);
    }
  }, [selectedProjectId, projects, projectId]);

  const activeProject = projects.find((p) => p.id === projectId);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!projectId) {
      setError('Please select an infrastructure project.');
      return;
    }
    if (!passcode.trim()) {
      setError(
        accountType === 'worker'
          ? 'Please enter the 4-digit worker PIN (e.g. 4444).'
          : 'Please enter the administrator password.'
      );
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const res = await login({
        projectId,
        accountType,
        passcode: passcode.trim()
      });

      if (res.success) {
        onLoginSuccess(accountType, projectId);
      } else {
        setError(res.error || 'Authentication failed. Please verify credentials.');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during login.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick 1-Click Golden Demo Login
  const handleQuickDemoLogin = async (targetRole: AccountType) => {
    let targetProject = projects.find((p) => p.code === 'REFINERY-U4');

    if (!targetProject) {
      if (onSeedGoldenDemo) {
        onSeedGoldenDemo();
      }
      setError('Golden Demo project not found. Please click "Seed Demo" first.');
      return;
    }

    const demoPin = targetRole === 'worker' ? '4444' : 'RefineryAdmin2026!';
    setProjectId(targetProject.id);
    setAccountType(targetRole);
    setPasscode(demoPin);
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await login({
        projectId: targetProject.id,
        accountType: targetRole,
        passcode: demoPin
      });

      if (res.success) {
        onLoginSuccess(targetRole, targetProject.id);
      } else {
        setError(res.error || 'Demo login failed.');
      }
    } catch (err: any) {
      setError(err.message || 'Network error during quick login.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-shell-container">
      <div className="login-card">
        {/* Header Branding */}
        <div className="login-card-header">
          <div className="login-badge-pill">
            <ShieldCheck size={14} className="login-badge-icon" />
            <span>FieldLine Secure Authentication</span>
          </div>
          <h1 className="login-title">Project Control Room & Execution Access</h1>
          <p className="login-subtitle">
            Select your operational role and sign in to access project telemetry, schedule baselines, or field reporting.
          </p>
        </div>

        {/* 1-Click Golden Demo Quick Access Banner */}
        <div className="demo-access-banner">
          <div className="demo-access-title">
            <Sparkles size={16} color="var(--accent-indigo)" />
            <span>Golden Demo Instant Access (REFINERY-U4)</span>
          </div>
          <p className="demo-access-desc">
            One-click sign-in to the SIH 2026 presentation dataset with pre-configured accounts:
          </p>
          <div className="demo-chips-grid">
            <button
              type="button"
              id="quick-demo-worker-btn"
              className="demo-chip-btn worker"
              onClick={() => handleQuickDemoLogin('worker')}
              disabled={isSubmitting || isSeedingDemo}
            >
              <User size={15} />
              <div className="demo-chip-text">
                <strong>Field Worker</strong>
                <span>PIN: 4444</span>
              </div>
            </button>

            <button
              type="button"
              id="quick-demo-admin-btn"
              className="demo-chip-btn admin"
              onClick={() => handleQuickDemoLogin('admin')}
              disabled={isSubmitting || isSeedingDemo}
            >
              <ShieldCheck size={15} />
              <div className="demo-chip-text">
                <strong>Admin / Superintendent</strong>
                <span>RefineryAdmin2026!</span>
              </div>
            </button>
          </div>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error-alert" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Project Selection */}
          <div className="login-field-group">
            <label htmlFor={projectSelectId} className="login-label">
              <FolderGit2 size={15} />
              <span>Target Infrastructure Project</span>
            </label>
            {projects.length > 0 ? (
              <div className="select-wrapper">
                <select
                  id={projectSelectId}
                  className="login-select"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    if (onSelectProject) {
                      onSelectProject(e.target.value);
                    }
                  }}
                  disabled={isSubmitting}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="no-projects-warning">
                <span>No registered projects found.</span>
                {onSeedGoldenDemo && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={onSeedGoldenDemo}
                    disabled={isSeedingDemo}
                  >
                    {isSeedingDemo ? 'Seeding...' : 'Load Golden Demo'}
                  </button>
                )}
              </div>
            )}
            {activeProject && (
              <span className="login-helper-text">
                {activeProject.description || 'Active industrial project workspace'}
              </span>
            )}
          </div>

          {/* Operational Shell / Role Selector Cards */}
          <div className="login-field-group">
            <label className="login-label">
              <User size={15} />
              <span>Select Operational Shell</span>
            </label>
            <div className="role-cards-grid">
              <button
                type="button"
                id="role-select-worker-btn"
                className={`role-select-card ${accountType === 'worker' ? 'selected' : ''}`}
                onClick={() => {
                  setAccountType('worker');
                  setPasscode('');
                  setError(null);
                }}
              >
                <div className="role-card-header">
                  <div className="role-icon-box worker">
                    <User size={20} />
                  </div>
                  <span className="role-shell-badge worker">Execution Cockpit</span>
                </div>
                <h3 className="role-card-title">Field Worker</h3>
                <p className="role-card-desc">
                  Optimized for mobile crews. Immediate shift tasks, one-touch progress reporting, and voice assistant.
                </p>
                <div className="role-card-indicator">
                  {accountType === 'worker' ? <CheckCircle2 size={16} /> : <div className="indicator-circle" />}
                  <span>Uses 4-Digit Passcode</span>
                </div>
              </button>

              <button
                type="button"
                id="role-select-admin-btn"
                className={`role-select-card ${accountType === 'admin' ? 'selected' : ''}`}
                onClick={() => {
                  setAccountType('admin');
                  setPasscode('');
                  setError(null);
                }}
              >
                <div className="role-card-header">
                  <div className="role-icon-box admin">
                    <ShieldCheck size={20} />
                  </div>
                  <span className="role-shell-badge admin">Control Room</span>
                </div>
                <h3 className="role-card-title">Admin / Project Engineer</h3>
                <p className="role-card-desc">
                  Full command dashboard. Ingest schedule baselines, review activity matches, inspect variance intelligence.
                </p>
                <div className="role-card-indicator">
                  {accountType === 'admin' ? <CheckCircle2 size={16} /> : <div className="indicator-circle" />}
                  <span>Uses Admin Password</span>
                </div>
              </button>
            </div>
          </div>

          {/* Passcode / Password Input */}
          <div className="login-field-group">
            <label htmlFor={passcodeFieldId} className="login-label">
              {accountType === 'worker' ? <KeyRound size={15} /> : <Lock size={15} />}
              <span>
                {accountType === 'worker' ? 'Worker Passcode / PIN' : 'Administrator Password'}
              </span>
            </label>
            <div className="passcode-input-wrapper">
              <input
                id={passcodeFieldId}
                type={accountType === 'worker' ? 'text' : 'password'}
                inputMode={accountType === 'worker' ? 'numeric' : 'text'}
                autoComplete="current-password"
                className="login-input"
                placeholder={
                  accountType === 'worker'
                    ? 'Enter 4-digit PIN (e.g. 4444)'
                    : 'Enter password (e.g. RefineryAdmin2026!)'
                }
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                disabled={isSubmitting || isLoading}
                autoFocus
              />
            </div>
            <span className="login-helper-text">
              {accountType === 'worker'
                ? 'PIN is shared among verified field crew personnel on this project.'
                : 'Project Superintendent or Field Engineer credentials.'}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="login-actions">
            {onCancel && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              id="login-submit-btn"
              className={`btn btn-primary login-submit-btn ${accountType}`}
              disabled={isSubmitting || isLoading || !projectId || !passcode.trim()}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={16} className="pulse-dot" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>
                    {accountType === 'worker'
                      ? 'Enter Execution Cockpit'
                      : 'Enter Admin Control Room'}
                  </span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
