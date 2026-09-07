import React, { useState, useEffect, useCallback, useId } from 'react';
import {
  User,
  LogOut,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Send,
  Sparkles,
  Paperclip,
  FileCheck,
  Search,
  Filter,
  ArrowRight,
  RefreshCw,
  MessageSquare,
  ClipboardList,
  Flame,
  ChevronRight,
  ShieldCheck,
  Building,
  HardHat
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { AssistantMarkdown } from '../assistant/AssistantMarkdown.js';
import { WorkerTab } from '../../router.js';

export interface WorkerActivity {
  id: string;
  projectId: string;
  scheduleId: string;
  externalId: string;
  name: string;
  description: string | null;
  wbsCode: string | null;
  location: string | null;
  plannedStart: string;
  plannedFinish: string;
  plannedQuantity: number | null;
  unit: string | null;
  baselineProgress: number;
}

export interface WorkerProgressUpdate {
  id: string;
  projectId: string;
  reportDate: string;
  reporterName: string | null;
  reporterRole: string | null;
  rawText: string;
  status: 'received' | 'processed' | 'reviewed';
  createdAt: string;
}

export interface WorkerCockpitViewProps {
  projectId: string;
  projectCode: string;
  projectName: string;
  activeWorkerTab: WorkerTab;
  onTabChange: (tab: WorkerTab) => void;
  onLogout: () => void;
  onSwitchToAdmin?: () => void;
  asOfDate?: string;
}

export function WorkerCockpitView({
  projectId,
  projectCode,
  projectName,
  activeWorkerTab,
  onTabChange,
  onLogout,
  onSwitchToAdmin,
  asOfDate = new Date().toISOString().slice(0, 10)
}: WorkerCockpitViewProps): React.JSX.Element {
  const { session, authFetch } = useAuth();

  // Activities & Schedules state
  const [activities, setActivities] = useState<WorkerActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState<boolean>(true);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<string>('all');

  // Recent Progress Updates state
  const [recentUpdates, setRecentUpdates] = useState<WorkerProgressUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState<boolean>(false);

  // Quick Report Form state
  const [reportDate, setReportDate] = useState<string>(asOfDate);
  const [selectedActivityId, setSelectedActivityId] = useState<string>('');
  const [reporterName, setReporterName] = useState<string>(() => session?.displayName || 'Crew Lead');
  const [reporterRole, setReporterRole] = useState<string>(() => session?.roleTitle || 'Field Lead');
  const [rawText, setRawText] = useState<string>('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [submittingReport, setSubmittingReport] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);

  // Field Assistant state
  const [assistantQuery, setAssistantQuery] = useState<string>('');
  const [assistantLoading, setAssistantLoading] = useState<boolean>(false);
  const [assistantResponse, setAssistantResponse] = useState<any | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);

  const reportDateId = useId();
  const reporterNameId = useId();
  const reporterRoleId = useId();
  const activitySelectId = useId();
  const notesFieldId = useId();
  const fileUploadId = useId();

  // Load activities for this project
  const fetchActivities = useCallback(async () => {
    setLoadingActivities(true);
    try {
      const schedRes = await authFetch(`/api/projects/${projectId}/schedules`);
      if (!schedRes.ok) return;
      const schedData = await schedRes.json();
      const schedules = schedData.schedules || [];
      if (schedules.length === 0) {
        setActivities([]);
        return;
      }
      const primarySchedule = schedules[0];
      const actRes = await authFetch(`/api/projects/${projectId}/schedules/${primarySchedule.id}/activities`);
      if (actRes.ok) {
        const actData = await actRes.json();
        setActivities(actData.activities || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingActivities(false);
    }
  }, [projectId, authFetch]);

  // Load recent progress updates
  const fetchRecentUpdates = useCallback(async () => {
    setLoadingUpdates(true);
    try {
      const res = await authFetch(`/api/projects/${projectId}/progress-updates`);
      if (res.ok) {
        const data = await res.json();
        setRecentUpdates((data.progressUpdates || []).slice(0, 10));
      }
    } catch {
      // ignore
    } finally {
      setLoadingUpdates(false);
    }
  }, [projectId, authFetch]);

  useEffect(() => {
    fetchActivities();
    fetchRecentUpdates();
  }, [fetchActivities, fetchRecentUpdates]);

  // Handle Quick Report Submission
  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) {
      setReportError('Please enter shift progress notes or describe completed work.');
      return;
    }

    setSubmittingReport(true);
    setReportError(null);
    setReportSuccess(null);

    try {
      // 1. Submit progress update record with human attribution
      const payload = {
        reportDate,
        rawText: rawText.trim(),
        reporterName: reporterName.trim() || session?.displayName || 'Worker Crew',
        reporterRole: reporterRole.trim() || 'Field Operations'
      };

      const res = await authFetch(`/api/projects/${projectId}/progress-updates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok || !data.progressUpdate) {
        throw new Error(data.error?.message || data.message || 'Failed to submit progress update');
      }

      const createdUpdate = data.progressUpdate;

      // 2. If evidence file is attached, upload it linked to this progress update
      if (evidenceFile) {
        const formData = new FormData();
        formData.append('file', evidenceFile);
        formData.append('progressUpdateId', createdUpdate.id);
        formData.append('fileType', evidenceFile.type.includes('image') ? 'image' : 'pdf');

        const uploadRes = await authFetch(`/api/projects/${projectId}/evidence`, {
          method: 'POST',
          body: formData
        });

        if (!uploadRes.ok) {
          const uploadData = await uploadRes.json();
          console.warn('Evidence upload failed:', uploadData);
        }
      }

      setReportSuccess(
        `Report successfully logged for ${createdUpdate.reporterName || 'Crew'} on ${createdUpdate.reportDate}. Linked to schedule matching pipeline.`
      );
      setRawText('');
      setEvidenceFile(null);
      fetchRecentUpdates();
    } catch (err: any) {
      setReportError(err.message || 'Error submitting report');
    } finally {
      setSubmittingReport(false);
    }
  };

  // Pre-fill quick report for a specific activity
  const handleReportForActivity = (act: WorkerActivity) => {
    setSelectedActivityId(act.id);
    setRawText(
      `Activity ${act.externalId} — ${act.name} (${act.location || 'Site'}): `
    );
    onTabChange('report');
  };

  // Add quick snippet to notes
  const handleAddSnippet = (snippet: string) => {
    setRawText((prev) => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed} ${snippet}` : snippet;
    });
  };

  // Ask field assistant
  const handleAskAssistant = async (queryText?: string) => {
    const q = queryText || assistantQuery;
    if (!q.trim()) return;

    setAssistantLoading(true);
    setAssistantError(null);
    setAssistantResponse(null);

    try {
      const res = await authFetch(`/api/projects/${projectId}/assistant/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question: q.trim(),
          asOfDate
        })
      });

      const data = await res.json();
      if (!res.ok || data.status === 'error') {
        throw new Error(data.message || 'Failed to generate assistant response');
      }

      setAssistantResponse(data);
    } catch (err: any) {
      setAssistantError(err.message || 'Assistant service unavailable');
    } finally {
      setAssistantLoading(false);
    }
  };

  // Filter activities
  const filteredActivities = activities.filter((act) => {
    const matchesSearch =
      !searchFilter ||
      act.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      act.externalId.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (act.location && act.location.toLowerCase().includes(searchFilter.toLowerCase()));

    const matchesArea =
      selectedAreaFilter === 'all' ||
      (act.location && act.location.toLowerCase().includes(selectedAreaFilter.toLowerCase())) ||
      (act.wbsCode && act.wbsCode.toLowerCase().includes(selectedAreaFilter.toLowerCase()));

    return matchesSearch && matchesArea;
  });

  return (
    <div className="worker-cockpit-shell">
      {/* Top Header & Operational Badge */}
      <header className="worker-cockpit-header">
        <div className="worker-identity-group">
          <div className="worker-role-badge">
            <span className="live-pulse-dot" />
            <strong>EXECUTION COCKPIT</strong>
          </div>
          <div className="worker-project-meta">
            <h1 className="worker-project-title">
              {projectCode} — {projectName}
            </h1>
            <div className="worker-user-attribution">
              <User size={13} />
              <span>Logged in as:</span>
              <strong>{session?.displayName || 'Field Crew'}</strong>
              {session?.roleTitle && <span className="worker-role-tag">({session.roleTitle})</span>}
            </div>
          </div>
        </div>

        <div className="worker-header-actions">
          {onSwitchToAdmin && (
            <button
              type="button"
              id="switch-to-admin-btn"
              className="btn btn-secondary btn-sm"
              onClick={onSwitchToAdmin}
              title="Switch to Admin Control Room"
            >
              <ShieldCheck size={14} color="var(--accent-indigo)" />
              <span>Admin Control Room</span>
            </button>
          )}

          <button
            type="button"
            id="worker-logout-btn"
            className="btn btn-outline btn-sm logout-btn"
            onClick={onLogout}
            title="Log out from worker session"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Primary Execution Navigation Tabs */}
      <nav className="worker-nav-tabs" aria-label="Worker operational tabs">
        <button
          type="button"
          id="worker-tab-work"
          className={`worker-nav-tab ${activeWorkerTab === 'work' ? 'active' : ''}`}
          onClick={() => onTabChange('work')}
        >
          <ClipboardList size={18} />
          <div className="tab-meta">
            <span className="tab-title">Today's Work</span>
            <span className="tab-counter">{activities.length} Packages</span>
          </div>
        </button>

        <button
          type="button"
          id="worker-tab-report"
          className={`worker-nav-tab ${activeWorkerTab === 'report' ? 'active' : ''}`}
          onClick={() => onTabChange('report')}
        >
          <Flame size={18} />
          <div className="tab-meta">
            <span className="tab-title">Quick Report</span>
            <span className="tab-counter">Fast Field Entry</span>
          </div>
        </button>

        <button
          type="button"
          id="worker-tab-assistant"
          className={`worker-nav-tab ${activeWorkerTab === 'assistant' ? 'active' : ''}`}
          onClick={() => onTabChange('assistant')}
        >
          <Sparkles size={18} />
          <div className="tab-meta">
            <span className="tab-title">Field Assistant</span>
            <span className="tab-counter">Grounded AI</span>
          </div>
        </button>
      </nav>

      {/* Main Tab Content */}
      <main className="worker-main-content">
        {/* ========================================================================= */}
        {/* TAB 1: TODAY'S WORK                                                       */}
        {/* ========================================================================= */}
        {activeWorkerTab === 'work' && (
          <section className="worker-tab-pane">
            <div className="pane-banner">
              <div>
                <h2 className="pane-title">Shift Work Packages & Activities</h2>
                <p className="pane-desc">
                  Active field activities assigned to project work areas. Tap "Report Progress" to log updates immediately.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onTabChange('report')}
              >
                <Flame size={15} />
                <span>New Field Report</span>
              </button>
            </div>

            {/* Filter Controls */}
            <div className="worker-filter-bar">
              <div className="search-input-wrapper" style={{ flex: '1 1 280px' }}>
                <Search size={16} className="search-icon" />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search by ID, name, or work area..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
              </div>

              <div className="area-chips-scroll">
                {[
                  { id: 'all', label: 'All Areas' },
                  { id: 'civil', label: 'Area A — Civil' },
                  { id: 'foundation', label: 'Area B — Foundation' },
                  { id: 'structural', label: 'Area C — Structural' },
                  { id: 'piping', label: 'Area D — Piping' },
                  { id: 'electrical', label: 'Area E — Electrical' },
                  { id: 'commissioning', label: 'Area F — Commissioning' }
                ].map((area) => (
                  <button
                    key={area.id}
                    type="button"
                    className={`area-filter-chip ${selectedAreaFilter === area.id ? 'active' : ''}`}
                    onClick={() => setSelectedAreaFilter(area.id)}
                  >
                    {area.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Activities List */}
            {loadingActivities ? (
              <div className="empty-state-card" style={{ padding: '3rem 1rem' }}>
                <RefreshCw size={28} className="pulse-dot" />
                <h3 className="empty-title">Loading Work Packages...</h3>
              </div>
            ) : filteredActivities.length === 0 ? (
              <div className="empty-state-card" style={{ padding: '3rem 1rem' }}>
                <ClipboardList size={32} />
                <h3 className="empty-title">No matching activities found</h3>
                <p className="empty-desc">Adjust your search query or area filters.</p>
              </div>
            ) : (
              <div className="worker-activities-grid">
                {filteredActivities.map((act) => (
                  <div key={act.id} className="worker-activity-card">
                    <div className="activity-card-top">
                      <span className="activity-id-badge">{act.externalId}</span>
                      {act.location && (
                        <span className="activity-area-badge">{act.location}</span>
                      )}
                    </div>

                    <h3 className="activity-card-name">{act.name}</h3>

                    {act.description && (
                      <p className="activity-card-desc">{act.description}</p>
                    )}

                    <div className="activity-dates-row">
                      <div className="date-item">
                        <Clock size={13} />
                        <span>Finish: {act.plannedFinish || '—'}</span>
                      </div>
                      {act.wbsCode && (
                        <div className="date-item mono">
                          <span>WBS: {act.wbsCode}</span>
                        </div>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div className="activity-progress-wrapper">
                      <div className="progress-info-row">
                        <span>Baseline Target</span>
                        <strong>{Math.round(act.baselineProgress || 0)}%</strong>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${Math.min(100, Math.max(0, act.baselineProgress || 0))}%` }}
                        />
                      </div>
                    </div>

                    <div className="activity-card-actions">
                      <button
                        type="button"
                        id={`report-activity-btn-${act.externalId}`}
                        className="btn btn-primary btn-sm report-act-btn"
                        onClick={() => handleReportForActivity(act)}
                      >
                        <Flame size={14} />
                        <span>Report Progress</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: QUICK REPORT FORM                                                  */}
        {/* ========================================================================= */}
        {activeWorkerTab === 'report' && (
          <section className="worker-tab-pane">
            <div className="pane-banner">
              <div>
                <h2 className="pane-title">Fast Field Progress Report</h2>
                <p className="pane-desc">
                  Log operational updates directly from the field. Updates are automatically routed to the schedule-matching engine.
                </p>
              </div>
            </div>

            {reportError && (
              <div className="login-error-alert" role="alert" style={{ marginBottom: '1rem' }}>
                <AlertTriangle size={16} />
                <span>{reportError}</span>
              </div>
            )}

            {reportSuccess && (
              <div className="report-success-banner" role="status" style={{ marginBottom: '1rem' }}>
                <CheckCircle2 size={16} />
                <span>{reportSuccess}</span>
              </div>
            )}

            <div className="report-layout-grid">
              {/* Report Input Form */}
              <form onSubmit={handleSubmitReport} className="quick-report-form">
                <div className="form-row-duo">
                  <div className="form-group">
                    <label htmlFor={reportDateId} className="worker-field-label">
                      <Calendar size={14} />
                      <span>Report Date</span>
                    </label>
                    <input
                      id={reportDateId}
                      type="date"
                      className="login-input"
                      value={reportDate}
                      onChange={(e) => setReportDate(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor={activitySelectId} className="worker-field-label">
                      <ClipboardList size={14} />
                      <span>Activity Focus (Optional)</span>
                    </label>
                    <select
                      id={activitySelectId}
                      className="login-select"
                      value={selectedActivityId}
                      onChange={(e) => {
                        const actId = e.target.value;
                        setSelectedActivityId(actId);
                        const act = activities.find((a) => a.id === actId);
                        if (act) {
                          handleAddSnippet(`[Activity ${act.externalId}: ${act.name}]`);
                        }
                      }}
                    >
                      <option value="">General Project / Area Work</option>
                      {activities.map((act) => (
                        <option key={act.id} value={act.id}>
                          {act.externalId} — {act.name} ({act.location || 'Site'})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Human Attribution Fields */}
                <div className="form-row-duo">
                  <div className="form-group">
                    <label htmlFor={reporterNameId} className="worker-field-label">
                      <User size={14} />
                      <span>Reporter Name (Attribution)</span>
                    </label>
                    <input
                      id={reporterNameId}
                      type="text"
                      className="login-input"
                      placeholder="e.g. Mike Ross (Welder Lead)"
                      value={reporterName}
                      onChange={(e) => setReporterName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor={reporterRoleId} className="worker-field-label">
                      <Building size={14} />
                      <span>Reporter Role / Trade</span>
                    </label>
                    <input
                      id={reporterRoleId}
                      type="text"
                      className="login-input"
                      placeholder="e.g. Piping Superintendent, Civil QC"
                      value={reporterRole}
                      onChange={(e) => setReporterRole(e.target.value)}
                    />
                  </div>
                </div>

                {/* Quick Snippet Helper Chips */}
                <div className="snippet-helper-section">
                  <span className="snippet-label">Tap to insert standard field phrase:</span>
                  <div className="snippet-chips-row">
                    <button
                      type="button"
                      className="snippet-chip"
                      onClick={() => handleAddSnippet('Completed planned concrete pour; awaiting 24hr cure.')}
                    >
                      + Pour completed
                    </button>
                    <button
                      type="button"
                      className="snippet-chip"
                      onClick={() => handleAddSnippet('Hydrostatic testing completed at 100% test pressure.')}
                    >
                      + Hydrotest passed
                    </button>
                    <button
                      type="button"
                      className="snippet-chip"
                      onClick={() => handleAddSnippet('Erection of structural steel frames 80% finished.')}
                    >
                      + Steel 80% erected
                    </button>
                    <button
                      type="button"
                      className="snippet-chip"
                      onClick={() => handleAddSnippet('Material delivery delay: pipe spools arriving tomorrow.')}
                    >
                      + Material delayed
                    </button>
                    <button
                      type="button"
                      className="snippet-chip"
                      onClick={() => handleAddSnippet('QA/QC inspector signed off work package.')}
                    >
                      + QC signoff complete
                    </button>
                  </div>
                </div>

                {/* Main Progress Description */}
                <div className="form-group">
                  <label htmlFor={notesFieldId} className="worker-field-label">
                    <MessageSquare size={14} />
                    <span>Field Observation & Progress Details</span>
                  </label>
                  <textarea
                    id={notesFieldId}
                    rows={4}
                    className="worker-textarea"
                    placeholder="Describe specific shift progress, quantities completed, trades on site, or blockers encountered..."
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    required
                  />
                </div>

                {/* Evidence / Photo Attachment */}
                <div className="form-group">
                  <label htmlFor={fileUploadId} className="worker-field-label">
                    <Paperclip size={14} />
                    <span>Attach Photo or Field Document (Optional)</span>
                  </label>
                  <div className="file-upload-box">
                    <input
                      id={fileUploadId}
                      type="file"
                      accept="image/*,.pdf,.xlsx,.csv,.txt"
                      onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                    />
                    {evidenceFile && (
                      <div className="selected-file-pill">
                        <FileCheck size={14} color="var(--accent-green)" />
                        <span>{evidenceFile.name}</span>
                        <button
                          type="button"
                          className="clear-file-btn"
                          onClick={() => setEvidenceFile(null)}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  id="submit-field-report-btn"
                  className="btn btn-primary submit-field-report-btn"
                  disabled={submittingReport || !rawText.trim()}
                >
                  {submittingReport ? (
                    <>
                      <RefreshCw size={16} className="pulse-dot" />
                      <span>Submitting Report...</span>
                    </>
                  ) : (
                    <>
                      <Flame size={16} />
                      <span>Submit Field Report</span>
                    </>
                  )}
                </button>
              </form>

              {/* Recent Reports Rail */}
              <div className="recent-reports-rail">
                <h3 className="rail-title">
                  <Clock size={15} />
                  <span>Recent Project Reports</span>
                </h3>
                {loadingUpdates ? (
                  <div className="loading-reports-spinner">
                    <RefreshCw size={18} className="pulse-dot" />
                    <span>Loading logs...</span>
                  </div>
                ) : recentUpdates.length === 0 ? (
                  <p className="no-reports-msg">No progress reports logged yet for this project.</p>
                ) : (
                  <div className="recent-reports-list">
                    {recentUpdates.map((up) => (
                      <div key={up.id} className="recent-report-card">
                        <div className="report-card-top">
                          <span className="report-card-date">{up.reportDate}</span>
                          <span className={`status-pill ${up.status}`}>{up.status}</span>
                        </div>
                        <p className="report-card-text">{up.rawText}</p>
                        <div className="report-card-reporter">
                          <User size={12} />
                          <span>{up.reporterName || 'Crew Member'}</span>
                          {up.reporterRole && <span className="mono">({up.reporterRole})</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: FIELD ASSISTANT                                                    */}
        {/* ========================================================================= */}
        {activeWorkerTab === 'assistant' && (
          <section className="worker-tab-pane">
            <div className="pane-banner">
              <div>
                <h2 className="pane-title">Operational Field Assistant</h2>
                <p className="pane-desc">
                  Ask grounded questions about project tasks, critical delays, and scheduled work packages.
                </p>
              </div>
            </div>

            {/* Quick Query Suggestions */}
            <div className="assistant-suggestions-bar">
              <span className="suggestion-label">Suggested Queries:</span>
              <div className="suggestion-chips-grid">
                <button
                  type="button"
                  className="suggestion-chip"
                  onClick={() => {
                    const q = 'What activities are delayed or at risk right now?';
                    setAssistantQuery(q);
                    handleAskAssistant(q);
                  }}
                >
                  "What activities are delayed or at risk?"
                </button>

                <button
                  type="button"
                  className="suggestion-chip"
                  onClick={() => {
                    const q = 'What is scheduled for piping in Area D?';
                    setAssistantQuery(q);
                    handleAskAssistant(q);
                  }}
                >
                  "What is scheduled for piping in Area D?"
                </button>

                <button
                  type="button"
                  className="suggestion-chip"
                  onClick={() => {
                    const q = 'What work was completed today or this week?';
                    setAssistantQuery(q);
                    handleAskAssistant(q);
                  }}
                >
                  "What work was completed today?"
                </button>
              </div>
            </div>

            {/* Question Input Box */}
            <div className="assistant-input-box">
              <input
                type="text"
                className="assistant-text-input"
                placeholder="Ask about project activities, delayed packages, or crew reports..."
                value={assistantQuery}
                onChange={(e) => setAssistantQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAskAssistant();
                  }
                }}
              />
              <button
                type="button"
                id="ask-assistant-submit-btn"
                className="btn btn-primary ask-assistant-btn"
                onClick={() => handleAskAssistant()}
                disabled={assistantLoading || !assistantQuery.trim()}
              >
                {assistantLoading ? (
                  <RefreshCw size={16} className="pulse-dot" />
                ) : (
                  <>
                    <span>Ask</span>
                    <Send size={15} />
                  </>
                )}
              </button>
            </div>

            {/* Assistant Response Area */}
            {assistantError && (
              <div className="login-error-alert" role="alert" style={{ marginTop: '1rem' }}>
                <AlertTriangle size={16} />
                <span>{assistantError}</span>
              </div>
            )}

            {assistantLoading && (
              <div className="assistant-thinking-card">
                <RefreshCw size={24} className="pulse-dot" />
                <h4>Consulting Project Schedule & Verification Facts...</h4>
                <p>Grounded in active SQLite schedule activities and verified field evidence.</p>
              </div>
            )}

            {assistantResponse && (
              <div className="worker-assistant-response-card">
                <div className="response-header">
                  <div className="response-badge">
                    <Sparkles size={14} color="var(--accent-indigo)" />
                    <span>Grounded Field Intelligence</span>
                  </div>
                  <span className="response-asof">As of {assistantResponse.asOfDate}</span>
                </div>

                <div className="response-body">
                  <AssistantMarkdown content={assistantResponse.answer} />
                </div>

                {/* Verified Facts Chips */}
                {assistantResponse.verifiedFacts && assistantResponse.verifiedFacts.length > 0 && (
                  <div className="response-facts-section">
                    <h4 className="facts-title">Verified Facts ({assistantResponse.verifiedFacts.length})</h4>
                    <div className="facts-grid">
                      {assistantResponse.verifiedFacts.map((fact: any) => (
                        <div key={fact.ref} className="verified-fact-chip">
                          <span className="fact-ref-badge">{fact.ref}</span>
                          <span className="fact-summary">{fact.summary}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
