import React, { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  ShieldCheck,
  Plus,
  ArrowLeft,
  Calendar,
  Clock,
  FolderGit2,
  Edit3,
  Trash2,
  Search,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  FileSpreadsheet,
  Activity,
  FileText,
  TrendingUp,
  Info,
  ChevronRight,
  UploadCloud,
  FileCheck,
  Check,
  AlertCircle,
  FileUp,
  User
} from 'lucide-react';

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  code: string;
  status: ProjectStatus;
  startDate: string | null;
  targetEndDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Schedule {
  id: string;
  projectId: string;
  name: string;
  version: string;
  sourceType: 'csv' | 'xlsx' | 'p6' | 'manual';
  sourceFilename: string | null;
  isBaseline: boolean;
  importedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleActivity {
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
  createdAt: string;
  updatedAt: string;
}

export interface ImportSummary {
  schedule: Schedule;
  activitiesImported: number;
  rowCount: number;
  sourceType: string;
  originalFilename: string;
}

export interface ScheduleValidationIssue {
  code: string;
  message: string;
  rowNumber?: number;
  field?: string;
  value?: unknown;
}

export interface ProgressUpdate {
  id: string;
  projectId: string;
  reportDate: string;
  reporterName: string | null;
  reporterRole: string | null;
  sourceType: 'manual' | 'voice' | 'pdf' | 'xlsx' | 'image' | 'text';
  rawText: string;
  status: 'received' | 'processed' | 'reviewed';
  createdAt: string;
  updatedAt: string;
}


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

const STORAGE_KEY_SELECTED_PROJECT = 'fieldline_selected_project_id';

export function App(): React.JSX.Element {
  // Projects State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Workspace View State
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'overview' | 'schedules' | 'progress'>('overview');

  // Schedules & Activities State
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [activities, setActivities] = useState<ScheduleActivity[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState<boolean>(false);
  const [loadingActivities, setLoadingActivities] = useState<boolean>(false);

  // Progress Updates State (PASS 7)
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);
  const [loadingProgressUpdates, setLoadingProgressUpdates] = useState<boolean>(false);
  const [reportFormData, setReportFormData] = useState({
    reportDate: new Date().toISOString().slice(0, 10),
    reporterName: '',
    reporterRole: '',
    rawText: ''
  });
  const [submittingReport, setSubmittingReport] = useState<boolean>(false);
  const [reportFormError, setReportFormError] = useState<string | null>(null);
  const [reportSuccessMessage, setReportSuccessMessage] = useState<string | null>(null);

  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ScheduleValidationIssue[]>([]);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  // Modals & UI State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    status: 'active' as ProjectStatus,
    startDate: '',
    targetEndDate: ''
  });

  // Notification Banner
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Backend Health Diagnostics
  const [health, setHealth] = useState<HealthData | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  // Show notification helper
  const showNotification = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 5000);
  }, []);

  // Fetch Health
  const fetchHealth = useCallback(async () => {
    const start = performance.now();
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      const end = performance.now();
      if (res.ok) {
        setHealth(data);
        setLatency(Math.round(end - start));
      }
    } catch {
      setHealth(null);
    }
  }, []);

  // Fetch Schedule Activities
  const fetchActivities = useCallback(async (projectId: string, scheduleId: string) => {
    setLoadingActivities(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/schedules/${scheduleId}/activities`);
      const data = await res.json();
      if (res.ok) {
        setActivities(data.activities || []);
      } else {
        setActivities([]);
      }
    } catch {
      setActivities([]);
    } finally {
      setLoadingActivities(false);
    }
  }, []);

  // Fetch Project Schedules
  const fetchSchedules = useCallback(async (projectId: string, preferredScheduleId?: string) => {
    setLoadingSchedules(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/schedules`);
      const data = await res.json();
      if (res.ok) {
        const scheduleList: Schedule[] = data.schedules || [];
        setSchedules(scheduleList);

        if (scheduleList.length > 0) {
          const target = preferredScheduleId
            ? scheduleList.find((s) => s.id === preferredScheduleId) || scheduleList[0]
            : scheduleList[0];
          setSelectedSchedule(target);
          await fetchActivities(projectId, target.id);
        } else {
          setSelectedSchedule(null);
          setActivities([]);
        }
      }
    } catch {
      setSchedules([]);
      setSelectedSchedule(null);
      setActivities([]);
    } finally {
      setLoadingSchedules(false);
    }
  }, [fetchActivities]);

  // Fetch Project Progress Updates (PASS 7)
  const fetchProgressUpdates = useCallback(async (projectId: string) => {
    setLoadingProgressUpdates(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/progress-updates`);
      const data = await res.json();
      if (res.ok) {
        setProgressUpdates(data.progressUpdates || []);
      } else {
        setProgressUpdates([]);
      }
    } catch {
      setProgressUpdates([]);
    } finally {
      setLoadingProgressUpdates(false);
    }
  }, []);

  // Fetch Projects and restore saved selection
  const fetchProjects = useCallback(async (preferredSelectId?: string) => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load projects');
      }

      const projectList: Project[] = data.projects || [];
      setProjects(projectList);

      const targetId = preferredSelectId || localStorage.getItem(STORAGE_KEY_SELECTED_PROJECT);
      if (targetId) {
        const found = projectList.find((p) => p.id === targetId);
        if (found) {
          setSelectedProject(found);
          localStorage.setItem(STORAGE_KEY_SELECTED_PROJECT, found.id);
          fetchSchedules(found.id);
          fetchProgressUpdates(found.id);
        } else {
          localStorage.removeItem(STORAGE_KEY_SELECTED_PROJECT);
          setSelectedProject(null);
          if (targetId && !preferredSelectId) {
            showNotification('info', 'Previously selected project was not found; returned to project list.');
          }
        }
      } else {
        setSelectedProject(null);
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Error connecting to API server');
    } finally {
      setLoadingProjects(false);
    }
  }, [showNotification, fetchSchedules, fetchProgressUpdates]);

  // Initial load
  useEffect(() => {
    fetchHealth();
    fetchProjects();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth, fetchProjects]);

  // Handle Opening a Project
  const handleOpenProject = (project: Project) => {
    setSelectedProject(project);
    setActiveWorkspaceTab('overview');
    setSelectedFile(null);
    setUploadError(null);
    setImportSummary(null);
    setReportFormError(null);
    setReportSuccessMessage(null);
    setReportFormData({
      reportDate: new Date().toISOString().slice(0, 10),
      reporterName: '',
      reporterRole: '',
      rawText: ''
    });
    localStorage.setItem(STORAGE_KEY_SELECTED_PROJECT, project.id);
    fetchSchedules(project.id);
    fetchProgressUpdates(project.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle Returning to Project Selector
  const handleBackToProjects = () => {
    setSelectedProject(null);
    setSelectedSchedule(null);
    setSchedules([]);
    setActivities([]);
    setProgressUpdates([]);
    setSelectedFile(null);
    setUploadError(null);
    setImportSummary(null);
    setReportFormError(null);
    setReportSuccessMessage(null);
    localStorage.removeItem(STORAGE_KEY_SELECTED_PROJECT);
  };

  // Reset Create Form
  const openCreateModal = () => {
    setFormData({
      name: '',
      code: '',
      description: '',
      status: 'active',
      startDate: '',
      targetEndDate: ''
    });
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  // Open Edit Form
  const openEditModal = () => {
    if (!selectedProject) return;
    setFormData({
      name: selectedProject.name,
      code: selectedProject.code,
      description: selectedProject.description || '',
      status: selectedProject.status,
      startDate: selectedProject.startDate ? selectedProject.startDate.slice(0, 10) : '',
      targetEndDate: selectedProject.targetEndDate ? selectedProject.targetEndDate.slice(0, 10) : ''
    });
    setFormError(null);
    setIsEditModalOpen(true);
  };

  // Submit Create Project
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim()) {
      setFormError('Project name and code are required.');
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        description: formData.description.trim() || null,
        status: formData.status,
        startDate: formData.startDate || null,
        targetEndDate: formData.targetEndDate || null
      };

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create project');
      }

      const created: Project = data.project;
      setIsCreateModalOpen(false);
      showNotification('success', `Project "${created.name}" created successfully.`);

      await fetchProjects(created.id);
    } catch (err: any) {
      setFormError(err.message || 'An error occurred while creating project.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Submit Edit Project
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;

    if (!formData.name.trim() || !formData.code.trim()) {
      setFormError('Project name and code are required.');
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        description: formData.description.trim() || null,
        status: formData.status,
        startDate: formData.startDate || null,
        targetEndDate: formData.targetEndDate || null
      };

      const res = await fetch(`/api/projects/${selectedProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update project');
      }

      const updated: Project = data.project;
      setSelectedProject(updated);
      setIsEditModalOpen(false);
      showNotification('success', `Project "${updated.name}" updated successfully.`);

      await fetchProjects(updated.id);
    } catch (err: any) {
      setFormError(err.message || 'An error occurred while updating project.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Submit Delete Project
  const handleDeleteSubmit = async () => {
    if (!selectedProject) return;

    setFormSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}`, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete project');
      }

      const deletedName = selectedProject.name;
      setIsDeleteModalOpen(false);
      setSelectedProject(null);
      localStorage.removeItem(STORAGE_KEY_SELECTED_PROJECT);
      showNotification('success', `Project "${deletedName}" was deleted.`);

      await fetchProjects();
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to delete project.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Drag & Drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file: File) => {
    setUploadError(null);
    setValidationIssues([]);
    setImportSummary(null);

    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      setUploadError('Unsupported file type. Please select a .csv or .xlsx schedule file.');
      setSelectedFile(null);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size exceeds the 10MB limit.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  // Schedule Import Upload Execution
  const handleImportSchedule = async () => {
    if (!selectedProject || !selectedFile) return;

    setIsUploading(true);
    setUploadError(null);
    setValidationIssues([]);
    setImportSummary(null);

    try {
      const formDataUpload = new FormData();
      formDataUpload.append('file', selectedFile);

      const res = await fetch(`/api/projects/${selectedProject.id}/schedules/import`, {
        method: 'POST',
        body: formDataUpload
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.details?.issues && Array.isArray(data.details.issues)) {
          setValidationIssues(data.details.issues);
        }
        throw new Error(data.error || 'Schedule import failed');
      }

      setImportSummary({
        schedule: data.schedule,
        activitiesImported: data.activitiesImported,
        rowCount: data.rowCount,
        sourceType: data.sourceType,
        originalFilename: data.originalFilename
      });

      setSelectedFile(null);
      showNotification('success', `Imported ${data.activitiesImported} activities from ${data.originalFilename}`);

      // Refresh project schedules
      await fetchSchedules(selectedProject.id, data.schedule.id);
    } catch (err: any) {
      setUploadError(err.message || 'An error occurred while importing schedule.');
    } finally {
      setIsUploading(false);
    }
  };

  // Switch Selected Schedule
  const handleSelectSchedule = (schedule: Schedule) => {
    setSelectedSchedule(schedule);
    if (selectedProject) {
      fetchActivities(selectedProject.id, schedule.id);
    }
  };

  // Format File Size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Handle Manual Progress Report Submission (PASS 7)
  const handleProgressUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;

    if (!reportFormData.rawText.trim()) {
      setReportFormError('Report text cannot be empty or whitespace only');
      return;
    }

    setSubmittingReport(true);
    setReportFormError(null);
    setReportSuccessMessage(null);

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/progress-updates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reportDate: reportFormData.reportDate,
          reporterName: reportFormData.reporterName.trim() || undefined,
          reporterRole: reportFormData.reporterRole.trim() || undefined,
          rawText: reportFormData.rawText
        })
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.error?.message || data.message || 'Failed to record progress update';
        setReportFormError(errorMsg);
        showNotification('error', errorMsg);
      } else {
        await fetchProgressUpdates(selectedProject.id);
        setReportFormData((prev) => ({
          ...prev,
          rawText: ''
        }));
        setReportSuccessMessage('Field progress report successfully recorded and persisted.');
        showNotification('success', 'Field update recorded successfully');
        setTimeout(() => setReportSuccessMessage(null), 5000);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Error recording field update';
      setReportFormError(errorMsg);
      showNotification('error', errorMsg);
    } finally {
      setSubmittingReport(false);
    }
  };

  // Filtered projects for search
  const filteredProjects = projects.filter((p) => {
    const query = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(query) ||
      p.code.toLowerCase().includes(query) ||
      (p.description && p.description.toLowerCase().includes(query)) ||
      p.status.toLowerCase().includes(query)
    );
  });

  const isOnline = health?.status === 'ok';

  return (
    <div className="container">
      {/* App Header */}
      <header className="app-header">
        <div className="brand-wrapper" onClick={handleBackToProjects}>
          <div className="logo-badge">
            <Layers size={24} color="#ffffff" />
          </div>
          <div>
            <h1 className="brand-title">FieldLine</h1>
            <p className="brand-tagline">
              Data Capture & Schedule-Linking Layer for Infrastructure Project Management
            </p>
          </div>
        </div>

        <div className="header-right">
          <button
            className="system-status-trigger"
            onClick={() => setIsDiagnosticsOpen(true)}
            title="Inspect system diagnostics and SQLite persistence"
          >
            <div className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
            <span>{isOnline ? 'System Online' : 'System Degraded'}</span>
            {latency !== null && <span style={{ opacity: 0.6 }}>({latency}ms)</span>}
          </button>
          <div className="badge-sih">
            <ShieldCheck size={14} />
            SIH 2026 &bull; SIH26122
          </div>
          <div className="badge-pass">
            Pass 7: Manual Progress Reporting
          </div>
        </div>
      </header>

      {/* Notification Banner */}
      {notification && (
        <div className={`notification-banner ${notification.type}`}>
          <div className="banner-content">
            {notification.type === 'success' && <CheckCircle2 size={18} />}
            {notification.type === 'error' && <AlertTriangle size={18} />}
            {notification.type === 'info' && <Info size={18} />}
            <span>{notification.message}</span>
          </div>
          <button
            className="banner-close"
            onClick={() => setNotification(null)}
            aria-label="Close notification"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {loadingProjects ? (
        <div className="empty-state-card">
          <div className="empty-icon-wrapper">
            <RefreshCw size={28} className="pulse-dot" />
          </div>
          <h2 className="empty-title">Loading FieldLine Projects...</h2>
          <p className="empty-desc">Connecting to local SQLite database service</p>
        </div>
      ) : selectedProject ? (
        /* ========================================================================= */
        /* CASE 3: OPENED PROJECT WORKSPACE                                          */
        /* ========================================================================= */
        <div className="workspace-view">
          {/* Workspace Header Card */}
          <div className="workspace-header-card">
            <div className="workspace-top-bar">
              <button
                id="back-to-projects-btn"
                className="back-btn"
                onClick={handleBackToProjects}
              >
                <ArrowLeft size={16} />
                <span>All Projects</span>
              </button>

              <div className="workspace-actions">
                <button
                  id="edit-project-btn"
                  className="btn btn-secondary btn-sm"
                  onClick={openEditModal}
                >
                  <Edit3 size={15} />
                  <span>Edit Metadata</span>
                </button>
                <button
                  id="delete-project-btn"
                  className="btn btn-danger btn-sm"
                  onClick={() => setIsDeleteModalOpen(true)}
                >
                  <Trash2 size={15} />
                  <span>Delete Project</span>
                </button>
              </div>
            </div>

            <div className="workspace-identity">
              <div className="workspace-title-section">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span className="workspace-code-badge">{selectedProject.code}</span>
                  <span className={`status-badge ${selectedProject.status}`}>
                    {selectedProject.status}
                  </span>
                </div>
                <h2 className="workspace-project-title">{selectedProject.name}</h2>
                {selectedProject.description ? (
                  <p className="workspace-project-desc">{selectedProject.description}</p>
                ) : (
                  <p className="workspace-project-desc" style={{ fontStyle: 'italic', opacity: 0.6 }}>
                    No project description provided.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Navigation Sub-Tabs */}
          <div className="workspace-tabs">
            <button
              className={`workspace-tab ${activeWorkspaceTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveWorkspaceTab('overview')}
            >
              <FolderGit2 size={16} />
              <span>Project Overview</span>
            </button>
            <button
              id="tab-schedules"
              className={`workspace-tab ${activeWorkspaceTab === 'schedules' ? 'active' : ''}`}
              onClick={() => setActiveWorkspaceTab('schedules')}
            >
              <FileSpreadsheet size={16} />
              <span>Schedules & Activities</span>
              {schedules.length > 0 && (
                <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                  {schedules.length}
                </span>
              )}
            </button>
            <button
              id="tab-progress"
              className={`workspace-tab ${activeWorkspaceTab === 'progress' ? 'active' : ''}`}
              onClick={() => {
                setActiveWorkspaceTab('progress');
                if (selectedProject) {
                  fetchProgressUpdates(selectedProject.id);
                }
              }}
            >
              <Activity size={16} />
              <span>Progress Updates</span>
              {progressUpdates.length > 0 && (
                <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                  {progressUpdates.length}
                </span>
              )}
            </button>
            <button className="workspace-tab future" disabled title="Evidence ingestion will be enabled in Pass 13">
              <FileText size={16} />
              <span>Evidence</span>
              <span className="tab-future-pill">Pass 13</span>
            </button>
            <button className="workspace-tab future" disabled title="AI insights will be enabled in Pass 8+">
              <TrendingUp size={16} />
              <span>Insights & Variance</span>
              <span className="tab-future-pill">Pass 8+</span>
            </button>
          </div>

          {/* Tab Content */}
          {activeWorkspaceTab === 'overview' ? (
            /* Tab 1: Project Overview Content */
            <div className="workspace-content">
              {/* Metadata Grid */}
              <div className="meta-grid">
                <div className="meta-card">
                  <span className="meta-card-label">
                    <Activity size={14} color="var(--accent-blue)" />
                    Lifecycle Status
                  </span>
                  <div style={{ marginTop: '0.2rem' }}>
                    <span className={`status-badge ${selectedProject.status}`} style={{ fontSize: '0.85rem' }}>
                      {selectedProject.status}
                    </span>
                  </div>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">
                    <FolderGit2 size={14} color="var(--accent-cyan)" />
                    Unique Project Code
                  </span>
                  <span className="meta-card-value mono">{selectedProject.code}</span>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">
                    <Calendar size={14} color="var(--accent-emerald)" />
                    Planned Start Date
                  </span>
                  <span className="meta-card-value">
                    {selectedProject.startDate ? selectedProject.startDate.slice(0, 10) : 'Not set'}
                  </span>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">
                    <Calendar size={14} color="var(--accent-amber)" />
                    Target Completion Date
                  </span>
                  <span className="meta-card-value">
                    {selectedProject.targetEndDate ? selectedProject.targetEndDate.slice(0, 10) : 'Not set'}
                  </span>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">
                    <Clock size={14} color="var(--accent-indigo)" />
                    Created Timestamp
                  </span>
                  <span className="meta-card-value" style={{ fontSize: '0.9rem' }}>
                    {new Date(selectedProject.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="meta-card">
                  <span className="meta-card-label">
                    <Clock size={14} color="var(--accent-purple)" />
                    Last Updated
                  </span>
                  <span className="meta-card-value" style={{ fontSize: '0.9rem' }}>
                    {new Date(selectedProject.updatedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Scope Card */}
              <div className="pass3-scope-card">
                <div className="pass3-scope-header">
                  <ShieldCheck size={18} />
                  <span>FieldLine Pass 7 Active Project Workspace</span>
                </div>
                <p className="pass3-scope-text">
                  This infrastructure project is fully registered in local SQLite persistence. Use the <strong>Schedules & Activities</strong> tab to import baseline schedules in <strong>.csv</strong> or <strong>.xlsx</strong> format, or switch to <strong>Progress Updates</strong> to record and persist raw manual field reports with verified data integrity.
                </p>
              </div>
            </div>
          ) : activeWorkspaceTab === 'schedules' ? (
            /* Tab 2: Schedules & Importer Content (PASS 4) */
            <div className="schedules-container">
              {/* Importer Section */}
              <div className="importer-card">
                <div className="importer-header">
                  <div className="importer-title-group">
                    <FileUp size={18} color="var(--accent-blue)" />
                    <h3 className="importer-title">Import Project Schedule</h3>
                  </div>
                  <div className="supported-formats-badge">
                    <FileSpreadsheet size={13} />
                    <span>CSV &bull; XLSX (Max 10MB)</span>
                  </div>
                </div>

                {/* Drag and Drop Zone */}
                <div
                  id="schedule-dropzone"
                  className={`dropzone ${dragActive ? 'drag-active' : ''}`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('schedule-file-input')?.click()}
                >
                  <input
                    id="schedule-file-input"
                    type="file"
                    className="file-input-hidden"
                    accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    onChange={handleFileInputChange}
                  />
                  <div className="dropzone-icon-wrapper">
                    <UploadCloud size={24} />
                  </div>
                  <h4 className="dropzone-title">
                    {selectedFile ? 'Change schedule file' : 'Click to select or drag and drop schedule file'}
                  </h4>
                  <p className="dropzone-desc">
                    FieldLine automatically maps column headers (Activity ID, Name, WBS, Location, Planned Start/Finish, Quantity, Unit).
                  </p>
                </div>

                {/* Selected File Bar */}
                {selectedFile && (
                  <div className="file-selected-bar">
                    <div className="file-info-group">
                      <div className="file-type-icon">
                        <FileCheck size={18} />
                      </div>
                      <div>
                        <div className="file-details-name">{selectedFile.name}</div>
                        <div className="file-details-meta">
                          {formatFileSize(selectedFile.size)} &bull; {selectedFile.name.endsWith('.csv') ? 'CSV File' : 'Excel Workbook'}
                        </div>
                      </div>
                    </div>

                    <div className="file-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setSelectedFile(null);
                          setUploadError(null);
                          setValidationIssues([]);
                        }}
                        disabled={isUploading}
                      >
                        Cancel
                      </button>
                      <button
                        id="submit-import-btn"
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleImportSchedule}
                        disabled={isUploading}
                      >
                        {isUploading ? (
                          <>
                            <RefreshCw size={14} className="pulse-dot" />
                            <span>Importing...</span>
                          </>
                        ) : (
                          <>
                            <FileUp size={14} />
                            <span>Import Schedule</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Validation Errors Box (PASS 6) */}
                {validationIssues.length > 0 ? (
                  <div className="validation-error-card">
                    <div className="validation-error-header">
                      <div className="validation-error-title-group">
                        <AlertCircle size={18} color="var(--accent-red)" />
                        <span>Schedule contains {validationIssues.length} validation error{validationIssues.length > 1 ? 's' : ''}</span>
                      </div>
                      <button
                        className="banner-close"
                        onClick={() => {
                          setValidationIssues([]);
                          setUploadError(null);
                        }}
                        aria-label="Close error"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="validation-issues-list">
                      {validationIssues.map((issue, idx) => (
                        <div key={idx} className="validation-issue-item">
                          <div className="validation-issue-meta">
                            {issue.rowNumber !== undefined && (
                              <span className="validation-row-badge">Row {issue.rowNumber}</span>
                            )}
                            {issue.field && (
                              <span className="validation-field-badge">{issue.field}</span>
                            )}
                            <span className="validation-code-badge">{issue.code}</span>
                          </div>
                          <div className="validation-issue-msg">{issue.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : uploadError && (
                  <div className="notification-banner error" style={{ marginTop: '1rem', marginBottom: '0' }}>
                    <div className="banner-content">
                      <AlertCircle size={18} />
                      <span>{uploadError}</span>
                    </div>
                    <button
                      className="banner-close"
                      onClick={() => setUploadError(null)}
                      aria-label="Close error"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                {/* Success Summary Banner */}
                {importSummary && (
                  <div className="import-summary-banner">
                    <div className="summary-details">
                      <div className="summary-icon">
                        <CheckCircle2 size={22} />
                      </div>
                      <div>
                        <div className="summary-text-main">
                          Import Complete: {importSummary.activitiesImported} activities persisted
                        </div>
                        <div className="summary-text-sub">
                          Schedule: <strong>{importSummary.schedule.name}</strong> &bull; Source: {importSummary.originalFilename} ({importSummary.sourceType.toUpperCase()}) &bull; Baseline: {importSummary.schedule.isBaseline ? 'Active' : 'No'}
                        </div>
                      </div>
                    </div>
                    <button
                      className="banner-close"
                      onClick={() => setImportSummary(null)}
                      aria-label="Dismiss summary"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>

              {/* Schedules Selector and Activity Table */}
              {loadingSchedules ? (
                <div className="empty-state-card" style={{ padding: '2.5rem 1.5rem' }}>
                  <RefreshCw size={24} className="pulse-dot" />
                  <p className="empty-desc" style={{ marginTop: '0.75rem' }}>Loading schedules...</p>
                </div>
              ) : schedules.length > 0 ? (
                <div className="activities-card">
                  {/* Selector Bar */}
                  <div className="schedules-selector-bar">
                    <div className="schedules-pills-list">
                      <span style={{ fontSize: '0.775rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Schedules:
                      </span>
                      {schedules.map((s) => (
                        <button
                          key={s.id}
                          className={`schedule-pill-btn ${selectedSchedule?.id === s.id ? 'active' : ''}`}
                          onClick={() => handleSelectSchedule(s)}
                        >
                          <FileSpreadsheet size={13} />
                          <span>{s.name}</span>
                          {s.isBaseline && <span className="baseline-tag">Baseline</span>}
                          <span className="format-tag">{s.sourceType}</span>
                        </button>
                      ))}
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Imported: {selectedSchedule ? new Date(selectedSchedule.importedAt).toLocaleDateString() : ''}
                    </div>
                  </div>

                  {/* Header with Activity Count */}
                  <div className="activities-card-header">
                    <div className="activities-header-left">
                      <h4 className="schedule-title">{selectedSchedule?.name || 'Schedule Activities'}</h4>
                      <span className="activity-count-badge">
                        <Activity size={12} />
                        {activities.length} {activities.length === 1 ? 'Activity' : 'Activities'}
                      </span>
                    </div>

                    {selectedSchedule?.sourceFilename && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Source: <span className="mono">{selectedSchedule.sourceFilename}</span>
                      </span>
                    )}
                  </div>

                  {/* Activity Verification Table */}
                  {loadingActivities ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>
                      <RefreshCw size={20} className="pulse-dot" />
                      <p className="empty-desc" style={{ marginTop: '0.5rem' }}>Loading activities...</p>
                    </div>
                  ) : activities.length > 0 ? (
                    <div className="table-responsive">
                      <table className="activities-table">
                        <thead>
                          <tr>
                            <th>Activity ID</th>
                            <th>Activity Name</th>
                            <th>WBS</th>
                            <th>Location</th>
                            <th>Planned Start</th>
                            <th>Planned Finish</th>
                            <th style={{ textAlign: 'right' }}>Quantity</th>
                            <th>Unit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activities.map((act) => (
                            <tr key={act.id}>
                              <td>
                                <span className="act-id-cell">{act.externalId}</span>
                              </td>
                              <td style={{ fontWeight: 500 }}>{act.name}</td>
                              <td>
                                {act.wbsCode ? (
                                  <span className="wbs-badge">{act.wbsCode}</span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                                )}
                              </td>
                              <td>
                                {act.location || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                              <td>
                                <span className="date-cell">{act.plannedStart}</span>
                              </td>
                              <td>
                                <span className="date-cell">{act.plannedFinish}</span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {act.plannedQuantity !== null ? (
                                  <span className="qty-cell">
                                    {act.plannedQuantity.toLocaleString()}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                                )}
                              </td>
                              <td>
                                {act.unit || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty-state-card" style={{ padding: '2rem 1rem' }}>
                      <p className="empty-desc">No activities found for this schedule.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state-card">
                  <div className="empty-icon-wrapper">
                    <FileSpreadsheet size={32} />
                  </div>
                  <h3 className="empty-title">No Schedules Imported Yet</h3>
                  <p className="empty-desc">
                    Import your master construction schedule using the uploader above. FieldLine will extract all activity work items into the SQLite database.
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* Tab 3: Progress Updates Content (PASS 7) */
            <div className="progress-container">
              {/* Form Card: Record Manual Field Progress */}
              <div className="progress-form-card">
                <div className="progress-card-header">
                  <div className="progress-card-title-group">
                    <div className="progress-card-icon-badge">
                      <Activity size={18} color="var(--accent-blue)" />
                    </div>
                    <div>
                      <h3 className="progress-card-title">Record Manual Field Progress</h3>
                      <p className="progress-card-subtitle">
                        Capture ground-truth human updates with guaranteed raw-text preservation.
                      </p>
                    </div>
                  </div>
                  <div className="progress-mode-badge">
                    <ShieldCheck size={13} />
                    <span>PASS 7 &bull; Raw Data Capture</span>
                  </div>
                </div>

                {reportSuccessMessage && (
                  <div className="notification-banner success" style={{ marginBottom: '1rem' }}>
                    <CheckCircle2 size={16} />
                    <span>{reportSuccessMessage}</span>
                  </div>
                )}

                {reportFormError && (
                  <div className="notification-banner error" style={{ marginBottom: '1rem' }}>
                    <AlertTriangle size={16} />
                    <span>{reportFormError}</span>
                  </div>
                )}

                <form id="manual-progress-form" onSubmit={handleProgressUpdateSubmit}>
                  <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '1rem' }}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="report-date-input">
                        <Calendar size={13} style={{ display: 'inline', marginRight: '0.35rem', verticalAlign: 'middle' }} />
                        Report Date <span className="required-star">*</span>
                      </label>
                      <input
                        id="report-date-input"
                        type="date"
                        className="form-input"
                        value={reportFormData.reportDate}
                        onChange={(e) => setReportFormData({ ...reportFormData, reportDate: e.target.value })}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="reporter-name-input">
                        <User size={13} style={{ display: 'inline', marginRight: '0.35rem', verticalAlign: 'middle' }} />
                        Reporter Name
                      </label>
                      <input
                        id="reporter-name-input"
                        type="text"
                        className="form-input"
                        placeholder="e.g., Rajesh Sharma"
                        value={reportFormData.reporterName}
                        onChange={(e) => setReportFormData({ ...reportFormData, reporterName: e.target.value })}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="reporter-role-input">
                        <ShieldCheck size={13} style={{ display: 'inline', marginRight: '0.35rem', verticalAlign: 'middle' }} />
                        Reporter Role
                      </label>
                      <input
                        id="reporter-role-input"
                        type="text"
                        className="form-input"
                        placeholder="e.g., Site Supervisor / Project Engineer"
                        value={reportFormData.reporterRole}
                        onChange={(e) => setReportFormData({ ...reportFormData, reporterRole: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                    <label className="form-label" htmlFor="raw-text-input">
                      <FileText size={13} style={{ display: 'inline', marginRight: '0.35rem', verticalAlign: 'middle' }} />
                      Field Progress Report <span className="required-star">*</span>
                    </label>
                    <textarea
                      id="raw-text-input"
                      className="form-textarea"
                      rows={4}
                      placeholder="Foundation work at Block B is 60% complete. Concrete pouring started today."
                      value={reportFormData.rawText}
                      onChange={(e) => setReportFormData({ ...reportFormData, rawText: e.target.value })}
                      required
                      style={{ fontFamily: 'inherit', fontSize: '0.9rem' }}
                    />
                    <div className="raw-text-hint">
                      <span>Raw text integrity guaranteed: All metrics, numbers, and notes are preserved verbatim.</span>
                      <span className="mono">{reportFormData.rawText.length} chars</span>
                    </div>
                  </div>

                  <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setReportFormData({ ...reportFormData, rawText: '' })}
                      disabled={submittingReport || !reportFormData.rawText}
                    >
                      Clear Text
                    </button>
                    <button
                      id="submit-progress-update-btn"
                      type="submit"
                      className="btn btn-primary"
                      disabled={submittingReport || !reportFormData.rawText.trim()}
                    >
                      {submittingReport ? (
                        <>
                          <RefreshCw size={14} className="pulse-dot" />
                          <span>Recording Report...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={15} />
                          <span>Record Field Update</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* History Section: Stored Progress Updates */}
              <div className="progress-history-card">
                <div className="progress-card-header">
                  <div className="progress-card-title-group">
                    <div className="progress-card-icon-badge" style={{ background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.25)' }}>
                      <Clock size={18} color="var(--accent-emerald)" />
                    </div>
                    <div>
                      <h3 className="progress-card-title">Progress Update History</h3>
                      <p className="progress-card-subtitle">
                        Persisted chronological feed of ground-truth updates (newest reports first).
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className="status-badge active" style={{ fontSize: '0.75rem' }}>
                      {progressUpdates.length} {progressUpdates.length === 1 ? 'Report' : 'Reports'}
                    </span>
                    <button
                      id="refresh-progress-btn"
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => selectedProject && fetchProgressUpdates(selectedProject.id)}
                      disabled={loadingProgressUpdates}
                      title="Refresh updates from SQLite"
                    >
                      <RefreshCw size={13} className={loadingProgressUpdates ? 'pulse-dot' : ''} />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                {loadingProgressUpdates ? (
                  <div className="loading-state" style={{ padding: '3rem 1rem' }}>
                    <RefreshCw size={24} className="pulse-dot" color="var(--accent-blue)" />
                    <p style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>Loading progress updates from SQLite...</p>
                  </div>
                ) : progressUpdates.length === 0 ? (
                  <div id="progress-empty-state" className="progress-empty-state">
                    <div className="empty-icon-circle" style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                      <Activity size={28} color="var(--text-muted)" />
                    </div>
                    <h4 className="empty-title" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.4rem' }}>No Progress Updates Recorded</h4>
                    <p className="empty-desc" style={{ maxWidth: 450, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                      No manual field updates have been submitted for <strong>{selectedProject.name}</strong> yet. Use the form above to record your first field update.
                    </p>
                  </div>
                ) : (
                  <div id="progress-update-list" className="progress-feed">
                    {progressUpdates.map((update, idx) => (
                      <div
                        key={update.id}
                        id={`progress-update-item-${idx}`}
                        className="progress-item"
                      >
                        <div className="progress-item-header">
                          <div className="progress-item-meta-left">
                            <div className="progress-date-badge">
                              <Calendar size={13} />
                              <span>Report Date: {update.reportDate}</span>
                            </div>
                            {update.reporterName ? (
                              <div className="progress-reporter-badge">
                                <User size={13} />
                                <span>{update.reporterName}</span>
                                {update.reporterRole && (
                                  <span className="reporter-role-tag">({update.reporterRole})</span>
                                )}
                              </div>
                            ) : (
                              <div className="progress-reporter-badge" style={{ opacity: 0.6 }}>
                                <User size={13} />
                                <span>Anonymous Field Reporter</span>
                              </div>
                            )}
                          </div>

                          <div className="progress-item-meta-right">
                            <span className="badge-source-manual">
                              Source: {update.sourceType.toUpperCase()}
                            </span>
                            <span className={`status-badge ${update.status === 'received' ? 'active' : 'planning'}`} style={{ textTransform: 'capitalize' }}>
                              {update.status}
                            </span>
                            <span className="progress-timestamp" title={`Stored at: ${update.createdAt}`}>
                              <Clock size={12} />
                              {new Date(update.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>

                        <div className="progress-item-body">
                          <p className="progress-raw-text">{update.rawText}</p>
                        </div>

                        <div className="progress-item-footer">
                          <span className="progress-record-id mono">ID: {update.id}</span>
                          <span className="progress-pass-tag">Pass 7 Verified Raw Record &bull; Awaiting Pass 8 AI Extraction</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : projects.length === 0 ? (
        /* ========================================================================= */
        /* CASE 1: NO PROJECTS (EMPTY STATE)                                         */
        /* ========================================================================= */
        <div className="empty-state-card">
          <div className="empty-icon-wrapper">
            <FolderGit2 size={32} />
          </div>
          <h2 className="empty-title">No Projects Found</h2>
          <p className="empty-desc">
            FieldLine needs at least one infrastructure project to begin tracking schedules and field progress. Create your first project below.
          </p>
          <button
            id="create-first-project-btn"
            className="btn btn-primary"
            onClick={openCreateModal}
          >
            <Plus size={16} />
            <span>Create Project</span>
          </button>
        </div>
      ) : (
        /* ========================================================================= */
        /* CASE 2: PROJECT SELECTION SCREEN / LIST                                   */
        /* ========================================================================= */
        <div className="project-selector-view">
          <div className="section-toolbar">
            <div className="toolbar-title-group">
              <h2 className="section-title">
                <FolderGit2 size={22} color="var(--accent-blue)" />
                Infrastructure Projects
              </h2>
              <span className="section-subtitle">
                {projects.length} registered {projects.length === 1 ? 'project' : 'projects'} available
              </span>
            </div>

            <div className="toolbar-actions">
              <div className="search-input-wrapper">
                <Search size={15} className="search-icon" />
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search by name, code..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button
                id="create-project-btn"
                className="btn btn-primary"
                onClick={openCreateModal}
              >
                <Plus size={16} />
                <span>New Project</span>
              </button>
            </div>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="empty-state-card" style={{ padding: '3rem 1.5rem' }}>
              <p className="empty-desc" style={{ marginBottom: '1rem' }}>
                No projects matched your search query "{searchQuery}".
              </p>
              <button className="btn btn-secondary btn-sm" onClick={() => setSearchQuery('')}>
                Clear Search
              </button>
            </div>
          ) : (
            <div className="projects-grid">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className="project-card"
                  onClick={() => handleOpenProject(project)}
                >
                  <div className="project-card-header">
                    <div className="project-card-title-group">
                      <span className="project-code-tag">{project.code}</span>
                      <h3 className="project-card-name">{project.name}</h3>
                    </div>
                    <span className={`status-badge ${project.status}`}>
                      {project.status}
                    </span>
                  </div>

                  <p className="project-card-desc">
                    {project.description || 'No description provided for this infrastructure project.'}
                  </p>

                  <div className="project-card-meta">
                    <div className="meta-row">
                      <span className="meta-item-with-icon">
                        <Calendar size={13} />
                        Planned Start
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {project.startDate ? project.startDate.slice(0, 10) : 'Not specified'}
                      </span>
                    </div>

                    <div className="meta-row">
                      <span className="meta-item-with-icon">
                        <Calendar size={13} />
                        Target Completion
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {project.targetEndDate ? project.targetEndDate.slice(0, 10) : 'Not specified'}
                      </span>
                    </div>
                  </div>

                  <div className="project-card-footer">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenProject(project);
                      }}
                    >
                      <span>Open Workspace</span>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer Banner */}
      <footer className="footer-banner">
        <div className="footer-text">
          <strong>FieldLine Local Monolith</strong> &bull; Problem Statement SIH26122 &bull; Local SQLite WAL
        </div>
        <div className="footer-actions">
          <span className="footer-link">Database: {envDatabaseDisplay(health)}</span>
          <span className="footer-link">Port: 3001</span>
        </div>
      </footer>

      {/* Modal: Create Project */}
      {isCreateModalOpen && (
        <div className="modal-overlay" onClick={() => !formSubmitting && setIsCreateModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create Infrastructure Project</h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={formSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                {formError && (
                  <div className="notification-banner error" style={{ marginBottom: '1rem' }}>
                    <AlertTriangle size={16} />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">
                    Project Name <span className="required-star">*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Mumbai Coastal Road Package 1"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    autoFocus
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">
                      Project Code <span className="required-star">*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. MCR-PKG1"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Lifecycle Status</label>
                    <select
                      className="form-select"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as ProjectStatus })}
                    >
                      <option value="planning">Planning</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Project Scope / Description</label>
                  <textarea
                    className="form-textarea"
                    placeholder="Provide a detailed scope summary of the infrastructure project..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Planned Start Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Target Completion Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={formData.targetEndDate}
                      onChange={(e) => setFormData({ ...formData, targetEndDate: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={formSubmitting}
                >
                  Cancel
                </button>
                <button
                  id="submit-create-project-btn"
                  type="submit"
                  className="btn btn-primary"
                  disabled={formSubmitting}
                >
                  {formSubmitting ? 'Creating Project...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Project */}
      {isEditModalOpen && selectedProject && (
        <div className="modal-overlay" onClick={() => !formSubmitting && setIsEditModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit Project Metadata</h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsEditModalOpen(false)}
                disabled={formSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit}>
              <div className="modal-body">
                {formError && (
                  <div className="notification-banner error" style={{ marginBottom: '1rem' }}>
                    <AlertTriangle size={16} />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">
                    Project Name <span className="required-star">*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">
                      Project Code <span className="required-star">*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Lifecycle Status</label>
                    <select
                      className="form-select"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as ProjectStatus })}
                    >
                      <option value="planning">Planning</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Project Scope / Description</label>
                  <textarea
                    className="form-textarea"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Planned Start Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Target Completion Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={formData.targetEndDate}
                      onChange={(e) => setFormData({ ...formData, targetEndDate: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={formSubmitting}
                >
                  Cancel
                </button>
                <button
                  id="submit-edit-project-btn"
                  type="submit"
                  className="btn btn-primary"
                  disabled={formSubmitting}
                >
                  {formSubmitting ? 'Saving Changes...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Project Confirmation */}
      {isDeleteModalOpen && selectedProject && (
        <div className="modal-overlay" onClick={() => !formSubmitting && setIsDeleteModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--accent-rose)' }}>
                Delete Project
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={formSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                Are you sure you want to permanently delete <strong>{selectedProject.name}</strong> ({selectedProject.code})?
              </p>
              <div className="notification-banner error" style={{ margin: 0 }}>
                <AlertTriangle size={16} />
                <span>
                  All associated schedules, activities, and linked progress data in SQLite will be cascade deleted.
                </span>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={formSubmitting}
              >
                Cancel
              </button>
              <button
                id="confirm-delete-project-btn"
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteSubmit}
                disabled={formSubmitting}
              >
                {formSubmitting ? 'Deleting...' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostics Drawer / Modal */}
      {isDiagnosticsOpen && (
        <div className="modal-overlay" onClick={() => setIsDiagnosticsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">System Diagnostics & Storage</h3>
              <button className="modal-close-btn" onClick={() => setIsDiagnosticsOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="meta-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="meta-card">
                  <span className="meta-card-label">Server Status</span>
                  <span className="meta-card-value">{health?.status.toUpperCase() || 'OFFLINE'}</span>
                </div>
                <div className="meta-card">
                  <span className="meta-card-label">Database Path</span>
                  <span className="meta-card-value mono" style={{ fontSize: '0.75rem' }}>
                    {health?.database.path || 'Unknown'}
                  </span>
                </div>
                <div className="meta-card">
                  <span className="meta-card-label">Latency</span>
                  <span className="meta-card-value">{latency !== null ? `${latency} ms` : '—'}</span>
                </div>
                <div className="meta-card">
                  <span className="meta-card-label">Pass Version</span>
                  <span className="meta-card-value">Pass 7 Manual Reporting</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsDiagnosticsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function envDatabaseDisplay(health: HealthData | null): string {
  if (!health) return 'SQLite';
  return health.database.path;
}

export default App;
