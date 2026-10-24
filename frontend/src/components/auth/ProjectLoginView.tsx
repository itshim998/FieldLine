import { FieldLineMark } from '../ui/FieldLine.js';
import React, { useState, useEffect, useId } from 'react';
import {
  ShieldCheck,
  User,
  Lock,

  ArrowRight,
  RefreshCw,
  FolderGit2,
  AlertCircle,
  KeyRound,
  Eye,
  EyeOff
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
  defaultAccountType?: AccountType;
  onSelectProject?: (projectId: string) => void;
  onLoginSuccess: (role: AccountType, projectId: string) => void;
  onCancel?: () => void;
  onSeedGoldenDemo?: () => Promise<void> | void;
  isSeedingDemo?: boolean;
}

export function ProjectLoginView({
  projects,
  selectedProjectId,
  defaultAccountType = 'worker',
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

  const [accountType, setAccountType] = useState<AccountType>(defaultAccountType);
  const [passcode, setPasscode] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const projectSelectId = useId();
  const operationalShellSelectId = useId();
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
        setIsSubmitting(true);
        setError(null);
        try {
          await onSeedGoldenDemo();
        } catch {
          // ignore
        }
      }
      targetProject = projects.find((p) => p.code === 'REFINERY-U4');
      if (!targetProject) {
        setError('Demo unavailable. Try again.');
        setIsSubmitting(false);
        return;
      }
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
            <span>FieldLine</span>
          </div>
          <h1 className="login-title">Sign in to FieldLine</h1>
        </div>

        {/* Streamlined Login Form */}
        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error-alert" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Project Dropdown */}
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
                    {isSeedingDemo ? 'Seeding...' : 'Try the demo'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 2. Your role Dropdown Menu */}
          <div className="login-field-group">
            <label htmlFor={operationalShellSelectId} className="login-label">
              {accountType === 'worker' ? <User size={15} /> : <ShieldCheck size={15} />}
              <span>Your role</span>
            </label>
            <div className="select-wrapper">
              <select
                id={operationalShellSelectId}
                className="login-select"
                value={accountType}
                onChange={(e) => {
                  const newRole = e.target.value as AccountType;
                  setAccountType(newRole);
                  setPasscode('');
                  setError(null);
                }}
                disabled={isSubmitting}
              >
                <option value="admin">Project engineer</option>
                <option value="worker">Site worker</option>
              </select>
            </div>
          </div>

          {/* 3. Password Placeholder Input */}
          <div className="login-field-group">
            <label htmlFor={passcodeFieldId} className="login-label">
              {accountType === 'worker' ? <KeyRound size={15} /> : <Lock size={15} />}
              <span>
                {accountType === 'worker' ? 'Worker PIN' : 'Password'}
              </span>
            </label>
            <div className="passcode-input-wrapper">
              <input
                id={passcodeFieldId}
                type={showPassword ? 'text' : 'password'}
                inputMode={accountType === 'worker' ? 'numeric' : 'text'}
                autoComplete="current-password"
                className={`login-input ${accountType === 'admin' ? 'login-input--with-reveal' : ''}`}
                placeholder={
                  accountType === 'worker'
                    ? 'Enter 4-digit PIN'
                    : 'Enter password'
                }
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                disabled={isSubmitting || isLoading}
                autoFocus
              />
              {accountType === 'admin' && (
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="login-password-toggle"
                  title={showPassword ? 'Hide password' : 'Show password'}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              )}
            </div>
          </div>

          {/* 4. Login Button */}
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
                  <span>Sign in</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </form>

        {/* 5. Try the demo positioned below */}
        <div className="demo-access-banner demo-access-banner--separated">
          <div className="demo-access-title">
            <FieldLineMark size={16} />
            <span>Try the demo</span>
          </div>
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
                <span>Use demo access</span>
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
                <span>Use demo access</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
