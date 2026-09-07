import React from 'react';
import {
  ShieldCheck,
  User,
  LogOut,
  ArrowLeft,
  Edit3,
  Trash2,
  LayoutDashboard,
  FileSpreadsheet,
  Activity,
  FileText,
  TrendingUp,
  Activity as ActivityIcon
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { WorkspaceTab } from '../../router.js';

export interface AdminProject {
  id: string;
  name: string;
  description: string | null;
  code: string;
  status: string;
}

export interface AdminWorkspaceViewProps {
  project: AdminProject;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onBackToProjects: () => void;
  onEditProject: () => void;
  onDeleteProject: () => void;
  onLogout: () => void;
  onSwitchToWorker?: () => void;
  schedulesCount?: number;
  progressCount?: number;
  evidenceCount?: number;
  intelligenceFactsCount?: number;
  children: React.ReactNode;
}

export function AdminWorkspaceView({
  project,
  activeTab,
  onTabChange,
  onBackToProjects,
  onEditProject,
  onDeleteProject,
  onLogout,
  onSwitchToWorker,
  schedulesCount,
  progressCount,
  evidenceCount,
  intelligenceFactsCount,
  children
}: AdminWorkspaceViewProps): React.JSX.Element {
  const { session } = useAuth();

  return (
    <div className="admin-workspace-shell">
      {/* Authenticated Admin Session Control Bar */}
      <div className="admin-session-badge-bar">
        <div className="admin-badge-content">
          <div className="admin-role-badge">
            <ShieldCheck size={14} className="admin-badge-icon" />
            <span>ADMIN CONTROL ROOM</span>
          </div>
          <span className="badge-divider">•</span>
          <div className="admin-operator-identity">
            <span className="operator-label">Operator:</span>
            <strong className="operator-name">
              {session?.displayName || 'Refinery Project Superintendent'}
            </strong>
            {session?.roleTitle && (
              <span className="operator-role-tag">({session.roleTitle})</span>
            )}
          </div>
        </div>

        <div className="admin-badge-actions">
          {onSwitchToWorker && (
            <button
              type="button"
              id="admin-switch-to-worker-btn"
              className="btn btn-secondary btn-sm"
              onClick={onSwitchToWorker}
              title="Open Worker Execution Cockpit"
              style={{ gap: '0.4rem', fontSize: '0.8rem' }}
            >
              <User size={14} color="var(--accent-blue)" />
              <span>Worker Cockpit</span>
            </button>
          )}

          <button
            type="button"
            id="admin-logout-btn"
            className="btn btn-outline btn-sm logout-btn"
            onClick={onLogout}
            title="Sign out of Admin session"
            style={{ gap: '0.4rem', fontSize: '0.8rem' }}
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Workspace Header Card */}
      <div className="workspace-header-card">
        <div className="workspace-top-bar">
          <button
            type="button"
            id="back-to-projects-btn"
            className="back-btn"
            onClick={onBackToProjects}
          >
            <ArrowLeft size={16} />
            <span>All Projects</span>
          </button>

          <div className="workspace-actions">
            <button
              type="button"
              id="edit-project-btn"
              className="btn btn-secondary btn-sm"
              onClick={onEditProject}
            >
              <Edit3 size={15} />
              <span>Edit Metadata</span>
            </button>
            <button
              type="button"
              id="delete-project-btn"
              className="btn btn-danger btn-sm"
              onClick={onDeleteProject}
            >
              <Trash2 size={15} />
              <span>Delete Project</span>
            </button>
          </div>
        </div>

        <div className="workspace-identity">
          <div className="workspace-title-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span className="workspace-code-badge">{project.code}</span>
              <span className={`status-badge ${project.status}`}>{project.status}</span>
            </div>
            <h2 className="workspace-project-title">{project.name}</h2>
            {project.description ? (
              <p className="workspace-project-desc">{project.description}</p>
            ) : (
              <p className="workspace-project-desc" style={{ fontStyle: 'italic', opacity: 0.6 }}>
                No project description provided.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Workspace Sub-Tabs (Preserving all 6 tabs) */}
      <nav className="workspace-tabs" aria-label="Admin workspace tabs">
        <button
          type="button"
          id="tab-overview"
          className={`workspace-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => onTabChange('overview')}
        >
          <LayoutDashboard size={16} />
          <span>Project Dashboard</span>
        </button>

        <button
          type="button"
          id="tab-schedules"
          className={`workspace-tab ${activeTab === 'schedules' ? 'active' : ''}`}
          onClick={() => onTabChange('schedules')}
        >
          <FileSpreadsheet size={16} />
          <span>Schedule Baselines</span>
          {typeof schedulesCount === 'number' && schedulesCount > 0 && (
            <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
              {schedulesCount}
            </span>
          )}
        </button>

        <button
          type="button"
          id="tab-progress"
          className={`workspace-tab ${activeTab === 'progress' ? 'active' : ''}`}
          onClick={() => onTabChange('progress')}
        >
          <Activity size={16} />
          <span>Field Progress Updates</span>
          {typeof progressCount === 'number' && progressCount > 0 && (
            <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
              {progressCount}
            </span>
          )}
        </button>

        <button
          type="button"
          id="tab-evidence"
          className={`workspace-tab ${activeTab === 'evidence' ? 'active' : ''}`}
          onClick={() => onTabChange('evidence')}
        >
          <FileText size={16} />
          <span>Evidence Documents</span>
          {typeof evidenceCount === 'number' && evidenceCount > 0 && (
            <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
              {evidenceCount}
            </span>
          )}
        </button>

        <button
          type="button"
          id="tab-intelligence"
          className={`workspace-tab ${activeTab === 'intelligence' ? 'active' : ''}`}
          onClick={() => onTabChange('intelligence')}
        >
          <TrendingUp size={16} />
          <span>Project Intelligence</span>
          {typeof intelligenceFactsCount === 'number' && intelligenceFactsCount > 0 && (
            <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
              {intelligenceFactsCount} Facts
            </span>
          )}
        </button>

        {activeTab === 'activity-detail' && (
          <button
            type="button"
            id="tab-activity-detail"
            className="workspace-tab active"
            onClick={() => onTabChange('activity-detail')}
          >
            <ActivityIcon size={16} />
            <span>Activity Detail</span>
          </button>
        )}
      </nav>

      {/* Tab Panels Content */}
      <div className="workspace-tab-content">{children}</div>
    </div>
  );
}
