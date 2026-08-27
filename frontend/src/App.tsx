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
  User,
  Paperclip,
  ExternalLink
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

export interface Evidence {
  id: string;
  projectId: string;
  progressUpdateId: string | null;
  fileName: string;
  filePath: string;
  fileType: 'text' | 'xlsx' | 'pdf' | 'image' | 'transcript' | 'other';
  fileSizeBytes: number | null;
  mimeType: string | null;
  metadataJson: string | null;
  uploadedAt: string;
  createdAt: string;
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
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'overview' | 'schedules' | 'progress' | 'evidence'>('overview');


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

  // Evidence State (PASS 13 & PASS 14)
  const [evidenceList, setEvidenceList] = useState<Evidence[]>([]);
  const [loadingEvidence, setLoadingEvidence] = useState<boolean>(false);
  const [evidenceUploadFile, setEvidenceUploadFile] = useState<File | null>(null);
  const [evidenceSelectedUpdateId, setEvidenceSelectedUpdateId] = useState<string>('');
  const [uploadingEvidence, setUploadingEvidence] = useState<boolean>(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceSuccess, setEvidenceSuccess] = useState<string | null>(null);
  const [processingEvidenceId, setProcessingEvidenceId] = useState<string | null>(null);
  const [processingStatusMap, setProcessingStatusMap] = useState<Record<string, 'processing' | 'processed' | 'failed'>>({});

  // Activity Evidence Traceability Modal State
  const [traceActivity, setTraceActivity] = useState<ScheduleActivity | null>(null);
  const [activityEvidenceList, setActivityEvidenceList] = useState<Evidence[]>([]);
  const [loadingActivityEvidence, setLoadingActivityEvidence] = useState<boolean>(false);

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

  // Fetch Project Evidence (PASS 13)
  const fetchEvidence = useCallback(async (projectId: string) => {
    setLoadingEvidence(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/evidence`);
      const data = await res.json();
      if (res.ok) {
        setEvidenceList(data.evidence || []);
      } else {
        setEvidenceList([]);
      }
    } catch {
      setEvidenceList([]);
    } finally {
      setLoadingEvidence(false);
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
          fetchEvidence(found.id);
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
  }, [showNotification, fetchSchedules, fetchProgressUpdates, fetchEvidence]);

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
    setEvidenceError(null);
    setEvidenceSuccess(null);
    setEvidenceUploadFile(null);
    setProcessingEvidenceId(null);
    setProcessingStatusMap({});
    setReportFormData({
      reportDate: new Date().toISOString().slice(0, 10),
      reporterName: '',
      reporterRole: '',
      rawText: ''
    });
    localStorage.setItem(STORAGE_KEY_SELECTED_PROJECT, project.id);
    fetchSchedules(project.id);
    fetchProgressUpdates(project.id);
    fetchEvidence(project.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle Returning to Project Selector
  const handleBackToProjects = () => {
    setSelectedProject(null);
    setSelectedSchedule(null);
    setSchedules([]);
    setActivities([]);
    setProgressUpdates([]);
    setEvidenceList([]);
    setSelectedFile(null);
    setEvidenceUploadFile(null);
    setUploadError(null);
    setImportSummary(null);
    setReportFormError(null);
    setReportSuccessMessage(null);
    setEvidenceError(null);
    setEvidenceSuccess(null);
    setProcessingEvidenceId(null);
    setProcessingStatusMap({});
    setTraceActivity(null);
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

  // Handle Upload Evidence (PASS 13)
  const handleUploadEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !evidenceUploadFile) return;

    setUploadingEvidence(true);
    setEvidenceError(null);
    setEvidenceSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', evidenceUploadFile);
      if (evidenceSelectedUpdateId) {
        formData.append('progressUpdateId', evidenceSelectedUpdateId);
      }

      const res = await fetch(`/api/projects/${selectedProject.id}/evidence`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload evidence');
      }

      setEvidenceUploadFile(null);
      setEvidenceSelectedUpdateId('');
      setEvidenceSuccess(`Evidence file "${data.evidence.fileName}" uploaded and persisted successfully.`);
      showNotification('success', `Evidence "${data.evidence.fileName}" uploaded.`);
      await fetchEvidence(selectedProject.id);
      setTimeout(() => setEvidenceSuccess(null), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error uploading evidence';
      setEvidenceError(msg);
      showNotification('error', msg);
    } finally {
      setUploadingEvidence(false);
    }
  };

  // Handle Delete Evidence (PASS 13)
  const handleDeleteEvidence = async (evidenceId: string) => {
    if (!selectedProject) return;
    if (!window.confirm('Are you sure you want to delete this evidence file?')) return;

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/evidence/${evidenceId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showNotification('success', 'Evidence file deleted.');
        await fetchEvidence(selectedProject.id);
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete evidence');
      }
    } catch (err: unknown) {
      showNotification('error', err instanceof Error ? err.message : 'Error deleting evidence');
    }
  };

  // Handle Process Evidence Document (PASS 14)
  const handleProcessEvidence = async (evidenceId: string) => {
    if (!selectedProject) return;

    setProcessingEvidenceId(evidenceId);
    setProcessingStatusMap((prev) => ({ ...prev, [evidenceId]: 'processing' }));
    setEvidenceError(null);
    setEvidenceSuccess(null);

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/evidence/${evidenceId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data.error?.message || data.message || 'Failed to process evidence document';
        throw new Error(errorMsg);
      }

      setProcessingStatusMap((prev) => ({ ...prev, [evidenceId]: 'processed' }));
      const factCount = data.extraction?.items?.length ?? 0;
      setEvidenceSuccess(
        `Evidence processed successfully! Created Field Progress Report (${data.progressUpdate?.id?.slice(0, 8)}...) with ${factCount} extracted fact${factCount === 1 ? '' : 's'}.`
      );
      showNotification(
        'success',
        `Evidence processed: ${factCount} fact${factCount === 1 ? '' : 's'} extracted.`
      );

      // Refresh evidence list and progress updates
      await Promise.all([
        fetchEvidence(selectedProject.id),
        fetchProgressUpdates(selectedProject.id)
      ]);
    } catch (err: unknown) {
      setProcessingStatusMap((prev) => ({ ...prev, [evidenceId]: 'failed' }));
      const msg = err instanceof Error ? err.message : 'Error processing evidence document';
      setEvidenceError(msg);
      showNotification('error', msg);
    } finally {
      setProcessingEvidenceId(null);
    }
  };

  // Trace Evidence for Activity (PASS 13)
  const handleOpenActivityTrace = async (activity: ScheduleActivity) => {
    if (!selectedProject) return;
    setTraceActivity(activity);
    setLoadingActivityEvidence(true);
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/activities/${activity.id}/evidence`);
      const data = await res.json();
      if (res.ok) {
        setActivityEvidenceList(data.evidence || []);
      } else {
        setActivityEvidenceList([]);
      }
    } catch {
      setActivityEvidenceList([]);
    } finally {
      setLoadingActivityEvidence(false);
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
            <button
              id="tab-evidence"
              className={`workspace-tab ${activeWorkspaceTab === 'evidence' ? 'active' : ''}`}
              onClick={() => {
                setActiveWorkspaceTab('evidence');
                if (selectedProject) {
                  fetchEvidence(selectedProject.id);
                  fetchProgressUpdates(selectedProject.id);
                }
              }}
            >
              <FileText size={16} />
              <span>Evidence</span>
              {evidenceList.length > 0 && (
                <span className="status-badge active" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                  {evidenceList.length}
                </span>
              )}
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

              {/* Schedules and Activities View */}
              <div className="schedules-view-section">
                <div className="section-toolbar">
                  <div className="toolbar-left">
                    <h3 className="section-title">Schedule Activities</h3>
                    {selectedSchedule && (
                      <span className="status-badge active" style={{ fontSize: '0.8rem' }}>
                        {selectedSchedule.name} &bull; {activities.length} Work Items
                      </span>
                    )}
                  </div>

                  {/* Schedule Selector if multiple exist */}
                  {schedules.length > 1 && (
                    <div className="toolbar-right">
                      <label className="form-label" style={{ margin: 0, fontSize: '0.8rem' }}>Schedule:</label>
                      <select
                        className="form-select"
                        style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                        value={selectedSchedule?.id || ''}
                        onChange={(e) => {
                          const sched = schedules.find((s) => s.id === e.target.value);
                          if (sched) handleSelectSchedule(sched);
                        }}
                      >
                        {schedules.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.sourceType.toUpperCase()})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* If schedules exist */}
                {schedules.length > 0 ? (
                  <div className="activities-table-card">
                    {/* Schedule Metadata Bar */}
                    {selectedSchedule && (
                      <div className="schedules-selector-bar">
                        <div className="schedule-meta-pill">
                          <span className="meta-label">Source File:</span>
                          <span className="meta-val">{selectedSchedule.sourceFilename || 'Manual / Embedded'}</span>
                        </div>
                        <div className="schedule-meta-pill">
                          <span className="meta-label">Format:</span>
                          <span className="meta-val uppercase">{selectedSchedule.sourceType}</span>
                        </div>
                        <div className="schedule-meta-pill">
                          <span className="meta-label">Imported:</span>
                          <span className="meta-val">
                            {new Date(selectedSchedule.importedAt).toLocaleDateString()}
                          </span>
                        </div>
                        {selectedSchedule.isBaseline && (
                          <span className="status-badge active" style={{ fontSize: '0.75rem' }}>
                            Official Baseline
                          </span>
                        )}
                      </div>
                    )}

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
                              <th style={{ textAlign: 'center' }}>Evidence</th>
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
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', gap: '0.3rem', display: 'inline-flex', alignItems: 'center' }}
                                    onClick={() => handleOpenActivityTrace(act)}
                                    title="Trace originating evidence for this activity"
                                  >
                                    <Paperclip size={12} />
                                    <span>Trace</span>
                                  </button>
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
            </div>
          ) : activeWorkspaceTab === 'progress' ? (
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

                {reportFormError && (
                  <div className="notification-banner error" style={{ marginBottom: '1rem' }}>
                    <AlertTriangle size={16} />
                    <span>{reportFormError}</span>
                  </div>
                )}

                {reportSuccessMessage && (
                  <div className="notification-banner success" style={{ marginBottom: '1rem' }}>
                    <CheckCircle2 size={16} />
                    <span>{reportSuccessMessage}</span>
                  </div>
                )}

                <form onSubmit={handleProgressUpdateSubmit}>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">
                        Report Date <span className="required-star">*</span>
                      </label>
                      <input
                        type="date"
                        className="form-input"
                        value={reportFormData.reportDate}
                        onChange={(e) =>
                          setReportFormData({ ...reportFormData, reportDate: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Reporter Name (Optional)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Ramesh Deshmukh"
                        value={reportFormData.reporterName}
                        onChange={(e) =>
                          setReportFormData({ ...reportFormData, reporterName: e.target.value })
                        }
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Reporter Role (Optional)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Resident Site Engineer"
                        value={reportFormData.reporterRole}
                        onChange={(e) =>
                          setReportFormData({ ...reportFormData, reporterRole: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      Field Observation / Shift Narrative <span className="required-star">*</span>
                    </label>
                    <textarea
                      id="progress-report-raw-text"
                      className="form-textarea"
                      placeholder="Enter raw field observation notes, work progress percentages, foundation pour logs, or inspection records..."
                      value={reportFormData.rawText}
                      onChange={(e) =>
                        setReportFormData({ ...reportFormData, rawText: e.target.value })
                      }
                      rows={4}
                      required
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button
                      id="submit-progress-report-btn"
                      type="submit"
                      className="btn btn-primary"
                      disabled={submittingReport}
                    >
                      {submittingReport ? (
                        <>
                          <RefreshCw size={14} className="pulse-dot" />
                          <span>Persisting Field Update...</span>
                        </>
                      ) : (
                        <>
                          <FileUp size={14} />
                          <span>Submit Field Progress Report</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Progress Updates List */}
              <div className="progress-history-section">
                <div className="section-toolbar">
                  <div className="toolbar-left">
                    <h3 className="section-title">Field Progress History</h3>
                    <span className="status-badge active" style={{ fontSize: '0.8rem' }}>
                      {progressUpdates.length} {progressUpdates.length === 1 ? 'Report' : 'Reports'}
                    </span>
                  </div>
                  <div className="toolbar-right">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => selectedProject && fetchProgressUpdates(selectedProject.id)}
                      disabled={loadingProgressUpdates}
                    >
                      <RefreshCw size={14} className={loadingProgressUpdates ? 'pulse-dot' : ''} />
                      <span>Refresh Feed</span>
                    </button>
                  </div>
                </div>

                {loadingProgressUpdates ? (
                  <div style={{ padding: '3rem', textAlign: 'center' }}>
                    <RefreshCw size={24} className="pulse-dot" />
                    <p className="empty-desc" style={{ marginTop: '0.75rem' }}>Loading field updates...</p>
                  </div>
                ) : progressUpdates.length === 0 ? (
                  <div className="empty-state-card">
                    <div className="empty-icon-wrapper">
                      <Activity size={32} />
                    </div>
                    <h4 className="empty-title">No Field Reports Captured Yet</h4>
                    <p className="empty-desc">
                      Capture site observations, milestone completions, and shift summaries using the manual form above.
                    </p>
                  </div>
                ) : (
                  <div className="progress-updates-feed">
                    {progressUpdates.map((update) => (
                      <div key={update.id} className="progress-feed-item">
                        <div className="progress-item-header">
                          <div className="progress-item-meta-left">
                            <div className="progress-date-badge">
                              <Calendar size={13} />
                              <span>{update.reportDate}</span>
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
          ) : activeWorkspaceTab === 'evidence' ? (
            /* Tab 4: Evidence System & Provenance (PASS 13) */
            <div className="evidence-container">
              {/* Evidence Upload Card */}
              <div className="evidence-uploader-card">
                <div className="progress-card-header" style={{ marginBottom: '1rem' }}>
                  <div>
                    <h3 className="section-title">Upload Project Evidence</h3>
                    <p className="section-subtitle">
                      Attach ground-truth site memos, inspection sign-offs, batch tickets, or drawings to this project.
                    </p>
                  </div>
                </div>

                {evidenceError && (
                  <div className="notification-banner error" style={{ marginBottom: '1rem' }}>
                    <AlertTriangle size={16} />
                    <span>{evidenceError}</span>
                  </div>
                )}

                {evidenceSuccess && (
                  <div className="notification-banner success" style={{ marginBottom: '1rem' }}>
                    <CheckCircle2 size={16} />
                    <span>{evidenceSuccess}</span>
                  </div>
                )}

                <form onSubmit={handleUploadEvidence}>
                  <div className="form-row" style={{ alignItems: 'flex-end', marginBottom: '1rem' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">
                        Select Evidence File <span className="required-star">*</span>
                      </label>
                      <input
                        id="evidence-file-input"
                        type="file"
                        className="form-input"
                        onChange={(e) => {
                          if (e.target.files && e.target.files.length > 0) {
                            setEvidenceUploadFile(e.target.files[0]);
                          }
                        }}
                        required
                      />
                    </div>

                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">
                        Attach to Field Progress Report (Optional)
                      </label>
                      <select
                        id="evidence-progress-update-select"
                        className="form-select"
                        value={evidenceSelectedUpdateId}
                        onChange={(e) => setEvidenceSelectedUpdateId(e.target.value)}
                      >
                        <option value="">None (Project-level Evidence)</option>
                        {progressUpdates.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.reportDate} — {u.reporterName || 'Anonymous'} ({u.rawText.slice(0, 35)}...)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group" style={{ flexShrink: 0 }}>
                      <button
                        id="submit-evidence-upload-btn"
                        type="submit"
                        className="btn btn-primary"
                        disabled={uploadingEvidence || !evidenceUploadFile}
                        style={{ height: '42px' }}
                      >
                        {uploadingEvidence ? (
                          <>
                            <RefreshCw size={16} className="pulse-dot" />
                            <span>Uploading...</span>
                          </>
                        ) : (
                          <>
                            <UploadCloud size={16} />
                            <span>Upload Evidence</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              </div>

              {/* Evidence Inventory */}
              <div className="evidence-inventory-section">
                <div className="section-toolbar" style={{ marginBottom: '1rem' }}>
                  <div className="toolbar-left">
                    <h3 className="section-title">Evidence Inventory</h3>
                    <span className="status-badge active" style={{ fontSize: '0.8rem' }}>
                      {evidenceList.length} {evidenceList.length === 1 ? 'file' : 'files'}
                    </span>
                  </div>
                  <div className="toolbar-right">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => selectedProject && fetchEvidence(selectedProject.id)}
                      disabled={loadingEvidence}
                    >
                      <RefreshCw size={14} className={loadingEvidence ? 'pulse-dot' : ''} />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                {loadingEvidence ? (
                  <div style={{ padding: '3rem', textAlign: 'center' }}>
                    <RefreshCw size={24} className="pulse-dot" />
                    <p className="empty-desc" style={{ marginTop: '0.75rem' }}>Loading project evidence...</p>
                  </div>
                ) : evidenceList.length === 0 ? (
                  <div className="empty-state-card">
                    <div className="empty-icon-wrapper">
                      <FileText size={32} />
                    </div>
                    <h4 className="empty-title">No Evidence Attached Yet</h4>
                    <p className="empty-desc">
                      Upload PDF blueprints, inspection tickets, site photos, or Excel logs above to establish traceable provenance.
                    </p>
                  </div>
                ) : (
                  <div className="evidence-grid">
                    {evidenceList.map((ev) => (
                      <div key={ev.id} className="evidence-card">
                        <div>
                          <div className="evidence-card-header">
                            <div className="evidence-title-group">
                              <FileText size={20} color="var(--accent-blue)" style={{ flexShrink: 0 }} />
                              <span className="evidence-file-name" title={ev.fileName}>
                                {ev.fileName}
                              </span>
                            </div>
                            <span className={`evidence-badge ${ev.fileType}`}>
                              {ev.fileType}
                            </span>
                          </div>

                          <div className="evidence-meta-list" style={{ marginTop: '0.75rem' }}>
                            <div className="evidence-meta-row">
                              <span style={{ color: 'var(--text-muted)' }}>Size:</span>
                              <span className="mono">{ev.fileSizeBytes !== null ? formatFileSize(ev.fileSizeBytes) : '—'}</span>
                            </div>
                            <div className="evidence-meta-row">
                              <span style={{ color: 'var(--text-muted)' }}>Uploaded:</span>
                              <span>{new Date(ev.uploadedAt).toLocaleString()}</span>
                            </div>
                            {ev.progressUpdateId && (
                              <div className="evidence-meta-row">
                                <span style={{ color: 'var(--text-muted)' }}>Report:</span>
                                <span className="mono" style={{ fontSize: '0.7rem' }}>{ev.progressUpdateId.slice(0, 12)}...</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="evidence-card-footer">
                          {['pdf', 'xlsx', 'image', 'text', 'transcript'].includes(ev.fileType) && (
                            <button
                              id={`process-evidence-btn-${ev.id}`}
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleProcessEvidence(ev.id)}
                              disabled={processingEvidenceId === ev.id}
                              style={{ gap: '0.35rem', fontSize: '0.75rem' }}
                              title="Extract document content and create progress update with AI facts"
                            >
                              {processingEvidenceId === ev.id ? (
                                <>
                                  <RefreshCw size={13} className="pulse-dot" />
                                  <span>Processing...</span>
                                </>
                              ) : processingStatusMap[ev.id] === 'processed' ? (
                                <>
                                  <CheckCircle2 size={13} color="var(--accent-emerald)" />
                                  <span>Processed</span>
                                </>
                              ) : processingStatusMap[ev.id] === 'failed' ? (
                                <>
                                  <AlertTriangle size={13} color="var(--accent-rose)" />
                                  <span>Retry Process</span>
                                </>
                              ) : (
                                <>
                                  <Activity size={13} />
                                  <span>Process</span>
                                </>
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => window.open(`/api/projects/${selectedProject.id}/evidence/${ev.id}/content`, '_blank')}
                            style={{ gap: '0.35rem', fontSize: '0.75rem' }}
                          >
                            <ExternalLink size={13} />
                            <span>Open Content</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDeleteEvidence(ev.id)}
                            style={{ color: 'var(--accent-rose)', borderColor: 'rgba(244, 63, 94, 0.2)' }}
                            title="Delete evidence record"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
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

      {/* Modal: Activity Evidence Provenance (PASS 13) */}
      {traceActivity && selectedProject && (
        <div className="modal-overlay" onClick={() => setTraceActivity(null)}>
          <div className="modal-card" style={{ maxWidth: '650px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Paperclip size={18} color="var(--accent-blue)" />
                  <span>Activity Evidence Provenance</span>
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  Trace all ground-truth evidence linked to <strong>{traceActivity.externalId} — {traceActivity.name}</strong>
                </p>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setTraceActivity(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {loadingActivityEvidence ? (
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                  <RefreshCw size={20} className="pulse-dot" />
                  <p className="empty-desc" style={{ marginTop: '0.5rem' }}>Tracing originating evidence...</p>
                </div>
              ) : activityEvidenceList.length === 0 ? (
                <div className="empty-state-card" style={{ padding: '2rem 1rem' }}>
                  <p className="empty-desc">
                    No originating evidence attached to this activity yet. Evidence uploaded with matching progress reports will automatically appear here.
                  </p>
                </div>
              ) : (
                <div className="evidence-trace-list">
                  {activityEvidenceList.map((ev) => (
                    <div key={ev.id} className="evidence-trace-item">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{ev.fileName}</span>
                          <span className={`evidence-badge ${ev.fileType}`}>{ev.fileType}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem' }}>
                          <span>Size: {ev.fileSizeBytes !== null ? formatFileSize(ev.fileSizeBytes) : '—'}</span>
                          <span>Uploaded: {new Date(ev.uploadedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => window.open(`/api/projects/${selectedProject.id}/evidence/${ev.id}/content`, '_blank')}
                        style={{ gap: '0.35rem', fontSize: '0.75rem' }}
                      >
                        <ExternalLink size={13} />
                        <span>View Evidence</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTraceActivity(null)}
              >
                Close
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
