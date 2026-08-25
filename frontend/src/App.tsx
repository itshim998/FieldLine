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
  Server,
  Database,
  ExternalLink,
  RefreshCw,
  FileSpreadsheet,
  Activity,
  FileText,
  TrendingUp,
  Info,
  ChevronRight
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
        } else {
          // Stored project no longer exists in database
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
  }, [showNotification]);

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
    localStorage.setItem(STORAGE_KEY_SELECTED_PROJECT, project.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle Returning to Project Selector
  const handleBackToProjects = () => {
    setSelectedProject(null);
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

      // Update state and immediately open project workspace
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

      // Refresh list in background
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
            Pass 3: Project Management
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
            <button className="workspace-tab active">
              <FolderGit2 size={16} />
              <span>Project Overview</span>
            </button>
            <button className="workspace-tab future" disabled title="Schedule importing will be enabled in Pass 4">
              <FileSpreadsheet size={16} />
              <span>Schedules</span>
              <span className="tab-future-pill">Pass 4</span>
            </button>
            <button className="workspace-tab future" disabled title="Progress reporting will be enabled in Pass 6">
              <Activity size={16} />
              <span>Progress Updates</span>
              <span className="tab-future-pill">Pass 6</span>
            </button>
            <button className="workspace-tab future" disabled title="Evidence ingestion will be enabled in Pass 5">
              <FileText size={16} />
              <span>Evidence</span>
              <span className="tab-future-pill">Pass 5</span>
            </button>
            <button className="workspace-tab future" disabled title="AI insights will be enabled in Pass 8+">
              <TrendingUp size={16} />
              <span>Insights & Variance</span>
              <span className="tab-future-pill">Pass 8+</span>
            </button>
          </div>

          {/* Project Overview Content */}
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

            {/* Scope / Pass 3 Card */}
            <div className="pass3-scope-card">
              <div className="pass3-scope-header">
                <ShieldCheck size={18} />
                <span>FieldLine Pass 3 Active Project Context</span>
              </div>
              <p className="pass3-scope-text">
                This infrastructure project is fully registered in local SQLite persistence. The active project context is maintained across browser refreshes. Next passes will enable baseline schedule ingestion (Pass 4), multi-modal evidence linking (Pass 5), and progress matching (Pass 6).
              </p>
            </div>
          </div>
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

      {/* ========================================================================= */}
      {/* MODAL: CREATE PROJECT                                                     */}
      {/* ========================================================================= */}
      {isCreateModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsCreateModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                <Plus size={18} color="var(--accent-blue)" />
                Create Infrastructure Project
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsCreateModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                {formError && (
                  <div className="danger-warning-box">
                    <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="create-name">
                    Project Name <span className="req">*</span>
                  </label>
                  <input
                    id="create-name"
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. Mumbai Coastal Road Tunnel Package 1"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="create-code">
                      Project Code <span className="req">*</span>
                    </label>
                    <input
                      id="create-code"
                      type="text"
                      required
                      className="form-input"
                      placeholder="e.g. MCR-PKG1"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="create-status">
                      Initial Status
                    </label>
                    <select
                      id="create-status"
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
                  <label className="form-label" htmlFor="create-desc">
                    Description
                  </label>
                  <textarea
                    id="create-desc"
                    className="form-textarea"
                    placeholder="Provide overview of scope, contractor, or geographical boundaries..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="create-start-date">
                      Planned Start Date
                    </label>
                    <input
                      id="create-start-date"
                      type="date"
                      className="form-input"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="create-target-date">
                      Target Completion Date
                    </label>
                    <input
                      id="create-target-date"
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
                  type="submit"
                  id="submit-create-project"
                  className="btn btn-primary"
                  disabled={formSubmitting}
                >
                  {formSubmitting ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDIT PROJECT METADATA                                              */}
      {/* ========================================================================= */}
      {isEditModalOpen && selectedProject && (
        <div className="modal-backdrop" onClick={() => setIsEditModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                <Edit3 size={18} color="var(--accent-blue)" />
                Edit Project Metadata
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsEditModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit}>
              <div className="modal-body">
                {formError && (
                  <div className="danger-warning-box">
                    <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="edit-name">
                    Project Name <span className="req">*</span>
                  </label>
                  <input
                    id="edit-name"
                    type="text"
                    required
                    className="form-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-code">
                      Project Code <span className="req">*</span>
                    </label>
                    <input
                      id="edit-code"
                      type="text"
                      required
                      className="form-input"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-status">
                      Status
                    </label>
                    <select
                      id="edit-status"
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
                  <label className="form-label" htmlFor="edit-desc">
                    Description
                  </label>
                  <textarea
                    id="edit-desc"
                    className="form-textarea"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-start-date">
                      Planned Start Date
                    </label>
                    <input
                      id="edit-start-date"
                      type="date"
                      className="form-input"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-target-date">
                      Target Completion Date
                    </label>
                    <input
                      id="edit-target-date"
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
                  type="submit"
                  id="submit-edit-project"
                  className="btn btn-primary"
                  disabled={formSubmitting}
                >
                  {formSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DELETE CONFIRMATION                                                */}
      {/* ========================================================================= */}
      {isDeleteModalOpen && selectedProject && (
        <div className="modal-backdrop" onClick={() => setIsDeleteModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottomColor: 'rgba(244, 63, 94, 0.2)' }}>
              <h3 className="modal-title" style={{ color: '#fb7185' }}>
                <AlertTriangle size={18} color="#fb7185" />
                Confirm Project Deletion
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsDeleteModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="danger-warning-box">
                <AlertTriangle size={20} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Warning: Destructive Operation</strong>
                  <p style={{ marginTop: '0.25rem' }}>
                    Deleting <strong>{selectedProject.name}</strong> ({selectedProject.code}) will permanently remove this project and cascade delete all associated data (schedules, activities, progress records, and evidence) in SQLite.
                  </p>
                </div>
              </div>

              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Are you sure you want to proceed with deleting this project?
              </p>
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
                type="button"
                id="confirm-delete-project-btn"
                className="btn btn-danger"
                onClick={handleDeleteSubmit}
                disabled={formSubmitting}
              >
                {formSubmitting ? 'Deleting...' : 'Delete Project Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: SYSTEM DIAGNOSTICS & PERSISTENCE HEALTH                            */}
      {/* ========================================================================= */}
      {isDiagnosticsOpen && (
        <div className="modal-backdrop" onClick={() => setIsDiagnosticsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                <Server size={18} color="var(--accent-blue)" />
                System & Database Diagnostics
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsDiagnosticsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="info-list" style={{ marginBottom: 0 }}>
                <div className="info-item">
                  <span className="info-key">Service</span>
                  <span className="info-val">{health?.service || 'FieldLine Backend'}</span>
                </div>
                <div className="info-item">
                  <span className="info-key">Version</span>
                  <span className="info-val">{health?.version || '0.1.0'}</span>
                </div>
                <div className="info-item">
                  <span className="info-key">Environment</span>
                  <span className="info-val">{health?.environment || 'development'}</span>
                </div>
                <div className="info-item">
                  <span className="info-key">Database Status</span>
                  <span className="info-val" style={{ color: health?.database.status === 'connected' ? '#34d399' : '#fb7185' }}>
                    {health?.database.status === 'connected' ? 'SQLite Connected (WAL)' : 'Disconnected'}
                  </span>
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
                  <span className="info-key">Latency</span>
                  <span className="info-val">{latency !== null ? `${latency} ms` : '—'}</span>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <a
                href="/api/health"
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
                style={{ textDecoration: 'none', marginRight: 'auto' }}
              >
                <ExternalLink size={14} />
                Raw /api/health
              </a>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsDiagnosticsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Banner */}
      <footer className="footer-banner">
        <div className="footer-text">
          <strong>FieldLine Pass 3 Active</strong> &bull; End-to-end Project Management & Context persistence enabled.
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
