import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Info,
  X,
  RefreshCw,
  MapPin,
  ClipboardList,
  Target,
  ArrowRight,
  ShieldAlert,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

export interface OperationalTaskItem {
  id: string;
  externalId: string;
  name: string;
  description: string | null;
  location: string | null;
  plannedStart: string;
  plannedFinish: string;
  plannedQuantity: number | null;
  unit: string | null;
  plannedProgress: number;
  actualProgress: number;
  status: 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'COMPLETED' | 'AHEAD';
  statusLabel: string;
  isToday: boolean;
  isUpcoming: boolean;
  isOverdue: boolean;
  isCompleted: boolean;
}

export interface OperationalTaskSummary {
  total: number;
  today: number;
  upcoming: number;
  completed: number;
  delayed: number;
  atRisk: number;
  onTrack: number;
}

export interface TodayWorkViewProps {
  projectId: string;
  asOfDate?: string;
  onReportActivity: (task: OperationalTaskItem) => void;
  onLogBlocker?: (task: OperationalTaskItem) => void;
  onOpenDetails?: (task: OperationalTaskItem) => void;
}

export const WORK_AREAS = [
  { id: 'all', label: 'All Areas' },
  { id: 'Area A', label: 'Area A — Civil' },
  { id: 'Area B', label: 'Area B — Foundation' },
  { id: 'Area C', label: 'Area C — Structural' },
  { id: 'Area D', label: 'Area D — Piping' },
  { id: 'Area E', label: 'Area E — Electrical' },
  { id: 'Area F', label: 'Area F — Commissioning' }
];

export function TodayWorkView({
  projectId,
  asOfDate = new Date().toISOString().slice(0, 10),
  onReportActivity,
  onLogBlocker,
  onOpenDetails
}: TodayWorkViewProps): React.JSX.Element {
  const { authFetch } = useAuth();

  const [tasks, setTasks] = useState<OperationalTaskItem[]>([]);
  const [summary, setSummary] = useState<OperationalTaskSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search states
  const [scope, setScope] = useState<'horizon' | 'today' | 'upcoming' | 'delayed' | 'all'>('horizon');
  const [selectedArea, setSelectedArea] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Task Detail Modal State
  const [activeModalTask, setActiveModalTask] = useState<OperationalTaskItem | null>(null);

  const fetchOperationalTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (asOfDate) params.append('asOfDate', asOfDate);
      if (scope) params.append('scope', scope);
      if (selectedArea && selectedArea !== 'all') {
        params.append('locationFilter', selectedArea);
      }

      const res = await authFetch(
        `/api/projects/${projectId}/worker/operational-tasks?${params.toString()}`
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || `Failed to fetch tasks (HTTP ${res.status})`);
      }

      const data = await res.json();
      setTasks(data.tasks || []);
      setSummary(data.summary || null);
    } catch (err: any) {
      setError(err.message || 'Error loading operational tasks');
    } finally {
      setLoading(false);
    }
  }, [projectId, asOfDate, scope, selectedArea, authFetch]);

  useEffect(() => {
    fetchOperationalTasks();
  }, [fetchOperationalTasks]);

  // Client-side instant search filtering
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const q = searchQuery.toLowerCase().trim();
    return tasks.filter(
      (t) =>
        t.externalId.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        (t.location && t.location.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q))
    );
  }, [tasks, searchQuery]);

  const handleOpenDetailModal = (task: OperationalTaskItem) => {
    setActiveModalTask(task);
    if (onOpenDetails) {
      onOpenDetails(task);
    }
  };

  const handleCloseDetailModal = () => {
    setActiveModalTask(null);
  };

  const getStatusBadgeClass = (status: OperationalTaskItem['status']) => {
    switch (status) {
      case 'ON_TRACK':
        return 'status-badge-on-track';
      case 'AT_RISK':
        return 'status-badge-at-risk';
      case 'DELAYED':
        return 'status-badge-delayed';
      case 'COMPLETED':
        return 'status-badge-completed';
      case 'AHEAD':
        return 'status-badge-ahead';
      default:
        return 'status-badge-on-track';
    }
  };

  const getProgressBarClass = (status: OperationalTaskItem['status']) => {
    switch (status) {
      case 'DELAYED':
        return 'progress-fill-delayed';
      case 'AT_RISK':
        return 'progress-fill-at-risk';
      case 'COMPLETED':
        return 'progress-fill-completed';
      default:
        return 'progress-fill-normal';
    }
  };

  return (
    <div className="today-work-container" data-testid="today-work-view">
      {/* Cockpit Horizon Header & Summary Counters */}
      <div className="operational-horizon-banner">
        <div className="banner-left">
          <div className="banner-title-row">
            <h2 className="operational-heading">Today's Execution Cockpit</h2>
            <span className="operational-date-chip">
              <Calendar size={13} />
              <span>Target Shift: {asOfDate}</span>
            </span>
          </div>
          <p className="operational-subheading">
            Operational projection bounded to active shift packages, target quantities, and immediate field priorities.
          </p>
        </div>

        {summary && (
          <div className="operational-summary-chips" data-testid="operational-summary-bar">
            <button
              type="button"
              className={`summary-pill ${scope === 'today' ? 'active' : ''}`}
              onClick={() => setScope('today')}
              title="Filter to tasks active today"
            >
              <span className="pill-dot today" />
              <span className="pill-label">Active Today</span>
              <strong className="pill-val">{summary.today}</strong>
            </button>

            <button
              type="button"
              className={`summary-pill ${scope === 'delayed' ? 'active' : ''}`}
              onClick={() => setScope('delayed')}
              title="Filter to delayed tasks"
            >
              <span className="pill-dot delayed" />
              <span className="pill-label">Delayed</span>
              <strong className="pill-val">{summary.delayed}</strong>
            </button>

            <button
              type="button"
              className={`summary-pill ${scope === 'upcoming' ? 'active' : ''}`}
              onClick={() => setScope('upcoming')}
              title="Filter to near-term upcoming tasks"
            >
              <span className="pill-dot upcoming" />
              <span className="pill-label">Upcoming (3d)</span>
              <strong className="pill-val">{summary.upcoming}</strong>
            </button>

            <button
              type="button"
              className={`summary-pill ${scope === 'horizon' ? 'active' : ''}`}
              onClick={() => setScope('horizon')}
              title="Filter to all operational horizon tasks"
            >
              <span className="pill-label">Shift Horizon</span>
              <strong className="pill-val">{tasks.length}</strong>
            </button>
          </div>
        )}
      </div>

      {/* Scope Horizon Tabs */}
      <div className="operational-scope-tabs" role="tablist" aria-label="Operational horizon filters">
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'horizon'}
          className={`scope-tab ${scope === 'horizon' ? 'active' : ''}`}
          onClick={() => setScope('horizon')}
          id="scope-tab-horizon"
        >
          <ClipboardList size={15} />
          <span>Operational Horizon</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={scope === 'today'}
          className={`scope-tab ${scope === 'today' ? 'active' : ''}`}
          onClick={() => setScope('today')}
          id="scope-tab-today"
        >
          <Calendar size={15} />
          <span>Active Today ({summary?.today ?? '—'})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={scope === 'delayed'}
          className={`scope-tab ${scope === 'delayed' ? 'active' : ''}`}
          onClick={() => setScope('delayed')}
          id="scope-tab-delayed"
        >
          <AlertTriangle size={15} />
          <span>Needs Attention ({summary?.delayed ?? '—'})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={scope === 'upcoming'}
          className={`scope-tab ${scope === 'upcoming' ? 'active' : ''}`}
          onClick={() => setScope('upcoming')}
          id="scope-tab-upcoming"
        >
          <Clock size={15} />
          <span>Upcoming 3-Day ({summary?.upcoming ?? '—'})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={scope === 'all'}
          className={`scope-tab ${scope === 'all' ? 'active' : ''}`}
          onClick={() => setScope('all')}
          id="scope-tab-all"
        >
          <span>All Packages</span>
        </button>
      </div>

      {/* Search & Area Filter Bar */}
      <div className="operational-filter-bar">
        <div className="search-input-wrapper">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            id="worker-task-search-input"
            placeholder="Search by ID, task name, or area..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="area-chips-scroll" role="group" aria-label="Filter by work area">
          {WORK_AREAS.map((area) => (
            <button
              key={area.id}
              type="button"
              id={`area-filter-${area.id.replace(/\s+/g, '-').toLowerCase()}`}
              className={`area-filter-chip ${selectedArea === area.id ? 'active' : ''}`}
              onClick={() => setSelectedArea(area.id)}
            >
              {area.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="operational-error-alert" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={fetchOperationalTasks}
            style={{ marginLeft: 'auto' }}
          >
            <RefreshCw size={13} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="operational-loading-card" data-testid="operational-loading">
          <RefreshCw size={28} className="pulse-dot" />
          <h3>Loading Operational Work Packages...</h3>
          <p>Filtering canonical schedule truth for shift date {asOfDate}</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="operational-empty-card" data-testid="operational-empty">
          <ClipboardList size={36} />
          <h3>No Operational Tasks Found</h3>
          <p>
            {searchQuery
              ? `No packages match "${searchQuery}" in this horizon scope.`
              : `No scheduled tasks found for ${selectedArea === 'all' ? 'the selected scope' : selectedArea} on ${asOfDate}.`}
          </p>
          {(searchQuery || selectedArea !== 'all' || scope !== 'horizon') && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSearchQuery('');
                setSelectedArea('all');
                setScope('horizon');
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        /* High-Density Task Cards Grid */
        <div className="operational-task-grid" data-testid="operational-task-grid">
          {filteredTasks.map((task) => (
            <article
              key={task.id}
              className={`operational-card ${task.isOverdue && !task.isCompleted ? 'overdue' : ''} ${task.isCompleted ? 'completed' : ''}`}
              data-testid={`task-card-${task.externalId}`}
            >
              {/* Top Row: Monospace ID, Location Badge, Status Pill */}
              <div className="card-header-row">
                <div className="header-meta-left">
                  <span className="task-id-badge" title={`External ID: ${task.externalId}`}>
                    {task.externalId}
                  </span>
                  {task.location && (
                    <span className="task-location-badge">
                      <MapPin size={12} />
                      <span>{task.location}</span>
                    </span>
                  )}
                </div>

                <div className="header-meta-right">
                  <span
                    className={`operational-status-pill ${getStatusBadgeClass(task.status)}`}
                    data-testid={`status-badge-${task.externalId}`}
                  >
                    <span className="status-dot" />
                    <span>{task.statusLabel}</span>
                  </span>
                </div>
              </div>

              {/* Task Name & Scope */}
              <h3 className="card-task-name">{task.name}</h3>

              {task.description && (
                <p className="card-task-desc">{task.description}</p>
              )}

              {/* Scope & Schedule Info Chips */}
              <div className="card-chips-row">
                {task.plannedQuantity !== null && task.plannedQuantity !== undefined && (
                  <span className="info-chip scope-chip" title="Target planned physical scope">
                    <Target size={12} />
                    <strong>
                      {task.plannedQuantity.toLocaleString()} {task.unit || 'units'}
                    </strong>
                  </span>
                )}

                <span
                  className={`info-chip date-chip ${task.isOverdue && !task.isCompleted ? 'overdue-date' : ''}`}
                  title={`Planned Schedule Window: ${task.plannedStart} to ${task.plannedFinish}`}
                >
                  <Clock size={12} />
                  <span>
                    {task.isCompleted
                      ? 'Completed'
                      : task.isOverdue
                        ? `Overdue (Due: ${task.plannedFinish})`
                        : task.isToday
                          ? `Active Today (Due: ${task.plannedFinish})`
                          : `Starts ${task.plannedStart}`}
                  </span>
                </span>
              </div>

              {/* Progress Dual Bar */}
              <div className="card-progress-section">
                <div className="progress-labels-row">
                  <span className="progress-label-left">
                    Actual: <strong>{Math.round(task.actualProgress)}%</strong>
                  </span>
                  <span className="progress-label-right">
                    Target: <span>{Math.round(task.plannedProgress)}%</span>
                  </span>
                </div>

                <div className="progress-track-wrapper">
                  <div className="progress-track">
                    <div
                      className={`progress-bar-fill ${getProgressBarClass(task.status)}`}
                      style={{ width: `${Math.min(100, Math.max(0, task.actualProgress))}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Glove-Friendly Direct Action Buttons */}
              <div className="card-actions-row">
                <button
                  type="button"
                  id={`report-activity-btn-${task.externalId}`}
                  data-testid={`report-activity-btn-${task.externalId}`}
                  className="btn btn-primary btn-touch report-act-btn"
                  onClick={() => onReportActivity(task)}
                  title={`Log shift progress update for ${task.externalId}`}
                >
                  <Flame size={15} />
                  <span>Report Progress</span>
                </button>

                {onLogBlocker && (
                  <button
                    type="button"
                    id={`blocker-btn-${task.externalId}`}
                    data-testid={`blocker-btn-${task.externalId}`}
                    className="btn btn-secondary btn-touch blocker-action-btn"
                    onClick={() => onLogBlocker(task)}
                    title={`Flag operational blocker on ${task.externalId}`}
                  >
                    <AlertTriangle size={14} color="var(--accent-amber)" />
                    <span>Log Blocker</span>
                  </button>
                )}

                <button
                  type="button"
                  id={`detail-btn-${task.externalId}`}
                  data-testid={`detail-btn-${task.externalId}`}
                  className="btn btn-outline btn-touch detail-action-btn"
                  onClick={() => handleOpenDetailModal(task)}
                  title={`View operational package details for ${task.externalId}`}
                >
                  <Info size={14} />
                  <span>Details</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Operational Task Detail Modal */}
      {activeModalTask && (
        <div
          className="operational-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-task-title"
          onClick={handleCloseDetailModal}
        >
          <div
            className="operational-modal-card"
            onClick={(e) => e.stopPropagation()}
            data-testid="task-detail-modal"
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="task-id-badge">{activeModalTask.externalId}</span>
                <span className={`operational-status-pill ${getStatusBadgeClass(activeModalTask.status)}`}>
                  <span className="status-dot" />
                  <span>{activeModalTask.statusLabel}</span>
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={handleCloseDetailModal}
                aria-label="Close task details"
              >
                <X size={18} />
              </button>
            </div>

            <h2 id="modal-task-title" className="modal-task-name">
              {activeModalTask.name}
            </h2>

            {activeModalTask.description && (
              <p className="modal-task-desc">{activeModalTask.description}</p>
            )}

            <div className="modal-details-grid">
              <div className="modal-metric-card">
                <span className="metric-label">Work Area / Location</span>
                <strong className="metric-value">
                  <MapPin size={14} />
                  <span>{activeModalTask.location || 'General Site'}</span>
                </strong>
              </div>

              <div className="modal-metric-card">
                <span className="metric-label">Physical Scope Target</span>
                <strong className="metric-value">
                  <Target size={14} />
                  <span>
                    {activeModalTask.plannedQuantity !== null
                      ? `${activeModalTask.plannedQuantity.toLocaleString()} ${activeModalTask.unit || 'units'}`
                      : 'Not Specified'}
                  </span>
                </strong>
              </div>

              <div className="modal-metric-card">
                <span className="metric-label">Planned Window</span>
                <strong className="metric-value">
                  <Calendar size={14} />
                  <span>
                    {activeModalTask.plannedStart} → {activeModalTask.plannedFinish}
                  </span>
                </strong>
              </div>

              <div className="modal-metric-card">
                <span className="metric-label">Actual Progress</span>
                <strong className="metric-value">
                  <span>{Math.round(activeModalTask.actualProgress)}%</span>
                  <span className="target-subtext">
                    (Target: {Math.round(activeModalTask.plannedProgress)}%)
                  </span>
                </strong>
              </div>
            </div>

            <div className="modal-actions-bar">
              <button
                type="button"
                className="btn btn-primary modal-primary-btn"
                onClick={() => {
                  handleCloseDetailModal();
                  onReportActivity(activeModalTask);
                }}
              >
                <Flame size={16} />
                <span>Report Progress for this Task</span>
              </button>

              {onLogBlocker && (
                <button
                  type="button"
                  className="btn btn-secondary modal-secondary-btn"
                  onClick={() => {
                    handleCloseDetailModal();
                    onLogBlocker(activeModalTask);
                  }}
                >
                  <AlertTriangle size={15} color="var(--accent-amber)" />
                  <span>Report Blocker</span>
                </button>
              )}

              <button
                type="button"
                className="btn btn-outline"
                onClick={handleCloseDetailModal}
              >
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
