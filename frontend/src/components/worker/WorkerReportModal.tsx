import React, { useState, useEffect, useId, useRef } from 'react';
import {
  Mic,
  MicOff,
  Flame,
  Camera,
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  User,
  Building,
  Calendar,
  Layers,
  Sparkles,
  ArrowRight,
  Plus,
  Minus,
  Check,
  Upload,
  Image as ImageIcon,
  Clock,
  HardHat,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { useLiveVoiceSession, VerifiedProgressUpdate } from '../assistant/live/useLiveVoiceSession.js';
import { OperationalTaskItem } from './TodayWorkView.js';

export type ReportCaptureTab = 'voice' | 'quantity' | 'photo';

export interface WorkerReportModalProps {
  projectId: string;
  projectCode?: string;
  isOpen: boolean;
  onClose: () => void;
  initialTask?: OperationalTaskItem | null;
  tasks?: OperationalTaskItem[];
  asOfDate?: string;
  onSuccess?: (result: any) => void;
}

export function WorkerReportModal({
  projectId,
  projectCode = 'PROJECT',
  isOpen,
  onClose,
  initialTask = null,
  tasks = [],
  asOfDate = new Date().toISOString().slice(0, 10),
  onSuccess
}: WorkerReportModalProps): React.JSX.Element | null {
  const { token, session, authFetch } = useAuth();

  // Active Tab
  const [activeTab, setActiveTab] = useState<ReportCaptureTab>('quantity');

  // Selected Activity
  const [selectedActivityId, setSelectedActivityId] = useState<string>(
    initialTask?.id || ''
  );

  // Rapid Quantity / % State
  const [reportDate, setReportDate] = useState<string>(asOfDate);
  const [actualQuantity, setActualQuantity] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<string>(
    initialTask ? String(initialTask.actualProgress) : ''
  );
  const [notes, setNotes] = useState<string>('');
  const [reporterName, setReporterName] = useState<string>(
    () => session?.displayName || 'Crew Lead'
  );
  const [reporterRole, setReporterRole] = useState<string>(
    () => session?.roleTitle || 'Field Lead'
  );

  // Photo Capture State
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Submission States
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [dedupedBadge, setDedupedBadge] = useState<boolean>(false);

  // Live Voice Session Hook
  const [voiceUpdates, setVoiceUpdates] = useState<VerifiedProgressUpdate[]>([]);
  const liveVoice = useLiveVoiceSession({
    projectId,
    role: 'worker',
    token,
    onVerifiedUpdate: (update) => {
      setVoiceUpdates((prev) => [update, ...prev]);
      if (onSuccess) onSuccess(update);
    },
    onError: (err) => {
      setErrorMsg(err);
    }
  });

  // Sync initial task when opened
  useEffect(() => {
    if (initialTask) {
      setSelectedActivityId(initialTask.id);
      if (initialTask.actualProgress !== undefined) {
        setProgressPercent(String(initialTask.actualProgress));
      }
    }
  }, [initialTask]);

  // Sync reporter attribution when auth session loads
  useEffect(() => {
    if (session?.displayName) {
      setReporterName(session.displayName);
    }
    if (session?.roleTitle) {
      setReporterRole(session.roleTitle);
    }
  }, [session]);

  // Clean up photo preview URL on unmount or change
  useEffect(() => {
    if (photoFile) {
      const url = URL.createObjectURL(photoFile);
      setPhotoPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setPhotoPreviewUrl(null);
    }
  }, [photoFile]);

  // Find active task object
  const activeTask = tasks.find((t) => t.id === selectedActivityId) || initialTask;

  // Derive calculated percentage preview if actual quantity is supplied
  const calculatedPercent = React.useMemo(() => {
    if (actualQuantity && activeTask?.plannedQuantity && activeTask.plannedQuantity > 0) {
      const qty = parseFloat(actualQuantity);
      if (!isNaN(qty) && qty >= 0) {
        return Math.min(100, Math.round((qty / activeTask.plannedQuantity) * 100));
      }
    }
    if (progressPercent !== '') {
      const pct = parseFloat(progressPercent);
      if (!isNaN(pct)) return Math.min(100, Math.max(0, pct));
    }
    return activeTask?.actualProgress ?? 0;
  }, [actualQuantity, progressPercent, activeTask]);

  // Handle Stepper Increment / Decrement
  const handleStepPercent = (delta: number) => {
    const current = parseFloat(progressPercent) || calculatedPercent || 0;
    const nextVal = Math.min(100, Math.max(0, current + delta));
    setProgressPercent(String(nextVal));
    if (activeTask?.plannedQuantity && activeTask.plannedQuantity > 0) {
      const derivedQty = Math.round((nextVal / 100) * activeTask.plannedQuantity * 10) / 10;
      setActualQuantity(String(derivedQty));
    }
  };

  // Add Phrase Snippet
  const handleAddSnippet = (snippet: string) => {
    setNotes((prev) => (prev.trim() ? `${prev.trim()} ${snippet}` : snippet));
  };

  // Handle Rapid Quantity Form Submission
  const handleSubmitRapidForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reporterName.trim()) {
      setErrorMsg('Reporter Name is required for attribution.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload: Record<string, any> = {
        reportDate,
        reporterName: reporterName.trim(),
        reporterRole: reporterRole.trim() || undefined,
        notes: notes.trim() || undefined,
        sourceType: 'manual'
      };

      if (selectedActivityId) {
        payload.activityId = selectedActivityId;
      }
      if (actualQuantity !== '') {
        payload.actualQuantity = parseFloat(actualQuantity);
        if (activeTask?.unit) {
          payload.quantityUnit = activeTask.unit;
        }
      }
      if (progressPercent !== '') {
        payload.progressPercent = parseFloat(progressPercent);
      }

      const res = await authFetch(`/api/projects/${projectId}/worker/quick-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to submit field report');
      }

      setSuccessMsg(
        data.message ||
          `Progress verified: ${activeTask?.name || 'Activity'} saved at ${data.derivedPercent ?? calculatedPercent}%.`
      );

      // If a photo was attached in rapid form, upload it now
      if (photoFile && data.progressUpdate?.id) {
        const formData = new FormData();
        formData.append('file', photoFile);
        formData.append('progressUpdateId', data.progressUpdate.id);
        formData.append('fileType', 'image');

        await authFetch(`/api/projects/${projectId}/evidence`, {
          method: 'POST',
          body: formData
        });
      }

      if (onSuccess) onSuccess(data);

      setTimeout(() => {
        setActualQuantity('');
        setNotes('');
        setPhotoFile(null);
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err.message || 'Submission error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Photo-only Capture Submission
  const handleSubmitPhotoForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoFile) {
      setErrorMsg('Please select or capture a photo first.');
      return;
    }
    if (!reporterName.trim()) {
      setErrorMsg('Reporter Name is required for attribution.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setDedupedBadge(false);

    try {
      // 1. Create quick report progress record with sourceType = 'image'
      const reportRes = await authFetch(`/api/projects/${projectId}/worker/quick-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportDate,
          activityId: selectedActivityId || undefined,
          reporterName: reporterName.trim(),
          reporterRole: reporterRole.trim() || undefined,
          notes: notes.trim() || `Photo evidence attached: ${photoFile.name}`,
          sourceType: 'image'
        })
      });

      const reportData = await reportRes.json();
      if (!reportRes.ok) {
        throw new Error(reportData.error || reportData.message || 'Failed to initialize photo record');
      }

      // 2. Upload the physical photo to evidence repository
      const formData = new FormData();
      formData.append('file', photoFile);
      formData.append('progressUpdateId', reportData.progressUpdate.id);
      formData.append('fileType', 'image');

      const evidenceRes = await authFetch(`/api/projects/${projectId}/evidence`, {
        method: 'POST',
        body: formData
      });

      const evidenceData = await evidenceRes.json();
      if (!evidenceRes.ok) {
        throw new Error(evidenceData.error || 'Failed to upload photo evidence');
      }

      setDedupedBadge(Boolean(evidenceData.deduplicated));
      setSuccessMsg(
        evidenceData.deduplicated
          ? `Photo matched existing SHA-256 hash (deduplicated). Linked to update.`
          : `Photo successfully captured & attached to activity log.`
      );

      if (onSuccess) onSuccess(evidenceData);

      setTimeout(() => {
        setPhotoFile(null);
        setNotes('');
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error uploading photo');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop worker-capture-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="worker-report-modal-title"
      id="worker-report-modal"
    >
      <div className="worker-capture-modal-panel">
        {/* Header */}
        <header className="worker-capture-header">
          <div className="header-badge-group">
            <div className="capture-header-pill">
              <Sparkles size={14} color="var(--accent-amber)" />
              <span className="pill-text">FRICTIONLESS FIELD CAPTURE</span>
            </div>
            <span className="project-code-chip">{projectCode}</span>
          </div>

          <button
            type="button"
            id="close-report-modal-btn"
            className="close-modal-btn"
            onClick={() => {
              if (liveVoice.isListening) {
                liveVoice.stopSession();
              }
              onClose();
            }}
            title="Close modal"
          >
            <X size={18} />
          </button>
        </header>

        {/* Modal Title & Subtitle */}
        <div className="worker-capture-title-bar">
          <h2 id="worker-report-modal-title" className="capture-title">
            {activeTask ? `Report on ${activeTask.externalId}` : 'Fast Field Progress Report'}
          </h2>
          <p className="capture-subtitle">
            {activeTask
              ? activeTask.name
              : 'Submit verified progress via voice dialogue, quick quantities, or camera evidence.'}
          </p>
        </div>

        {/* Capture Mode Navigation Tabs */}
        <nav className="capture-tab-nav" aria-label="Capture mode tabs">
          <button
            type="button"
            id="tab-voice"
            className={`capture-tab-btn ${activeTab === 'voice' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('voice');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
          >
            <Mic size={16} />
            <span>Live Voice</span>
            {liveVoice.isListening && <span className="tab-live-pulse" />}
          </button>

          <button
            type="button"
            id="tab-quantity"
            className={`capture-tab-btn ${activeTab === 'quantity' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('quantity');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
          >
            <Flame size={16} />
            <span>Quantity / %</span>
          </button>

          <button
            type="button"
            id="tab-photo"
            className={`capture-tab-btn ${activeTab === 'photo' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('photo');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
          >
            <Camera size={16} />
            <span>Photo Capture</span>
          </button>
        </nav>

        {/* Status Alerts */}
        {errorMsg && (
          <div className="login-error-alert" role="alert" style={{ margin: '0 1.25rem 1rem' }}>
            <AlertTriangle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="report-success-banner" role="status" style={{ margin: '0 1.25rem 1rem' }}>
            <CheckCircle2 size={16} />
            <span>{successMsg}</span>
            {dedupedBadge && <span className="deduped-badge">SHA-256 Verified</span>}
          </div>
        )}

        {/* Tab Body */}
        <div className="capture-modal-content-body">
          {/* ========================================================================= */}
          {/* TAB 1: LIVE VOICE DIALOGUE                                                */}
          {/* ========================================================================= */}
          {activeTab === 'voice' && (
            <div className="voice-tab-pane">
              {/* Central Mic Visualizer Card */}
              <div className="voice-mic-hero-card">
                <div className="voice-status-pill">
                  <span className={`status-dot ${liveVoice.connectionState}`} />
                  <span className="status-label">
                    {liveVoice.connectionState === 'ready' || liveVoice.connectionState === 'connected'
                      ? 'Connected & Grounded to Schedule'
                      : liveVoice.connectionState === 'connecting'
                      ? 'Establishing Multimodal Session...'
                      : 'Gemini Live Voice Gateway'}
                  </span>
                </div>

                {/* Animated Waveform Bars */}
                <div className="waveform-container" aria-hidden="true">
                  {liveVoice.frequencyBars.slice(0, 16).map((bar, idx) => {
                    const heightPct = Math.max(12, Math.min(100, bar * 100));
                    return (
                      <span
                        key={idx}
                        className={`waveform-bar ${liveVoice.isListening ? 'active' : ''}`}
                        style={{ height: `${heightPct}%` }}
                      />
                    );
                  })}
                </div>

                {/* Big Tactile Mic Button */}
                <button
                  type="button"
                  id="voice-toggle-btn"
                  className={`voice-mic-main-btn ${liveVoice.isListening ? 'listening' : ''}`}
                  onClick={() => liveVoice.toggleSession(projectId)}
                  aria-label={liveVoice.isListening ? 'Stop spoken voice session' : 'Start spoken voice session'}
                >
                  {liveVoice.isListening ? <MicOff size={32} /> : <Mic size={32} />}
                </button>

                <p className="voice-prompt-text">
                  {liveVoice.isListening
                    ? 'Listening... Speak naturally: "Pipe Rack PR-07 is at 65%" or "Block B excavation 80m3 done"'
                    : 'Tap microphone to speak field progress hands-free'}
                </p>
              </div>

              {/* Verified Progress Updates Feed */}
              {liveVoice.verifiedUpdates.length > 0 && (
                <div className="verified-updates-section">
                  <h4 className="section-mini-title">
                    <CheckCircle2 size={14} color="var(--accent-green)" />
                    <span>Verified Real-Time Updates</span>
                  </h4>
                  <div className="verified-updates-list">
                    {liveVoice.verifiedUpdates.map((up) => (
                      <div key={up.id} className="verified-update-card">
                        <div className="verified-card-badge">
                          <Check size={14} />
                          <span>{up.progressPercent}%</span>
                        </div>
                        <div className="verified-card-body">
                          <strong>{up.activityName}</strong>
                          <p>{up.message}</p>
                        </div>
                        <span className="verified-card-time">{up.timestamp}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live Transcript Stream */}
              {liveVoice.liveTranscript.length > 0 && (
                <div className="live-transcript-section">
                  <h4 className="section-mini-title">
                    <Clock size={14} />
                    <span>Live Spoken Dialogue</span>
                  </h4>
                  <div className="transcript-bubbles-box">
                    {liveVoice.liveTranscript.map((t) => (
                      <div key={t.id} className={`transcript-bubble ${t.sender}`}>
                        <span className="bubble-speaker">{t.sender === 'user' ? 'Worker' : 'FieldLine'}:</span>
                        <span className="bubble-text">{t.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: RAPID QUANTITY / % FORM                                            */}
          {/* ========================================================================= */}
          {activeTab === 'quantity' && (
            <form onSubmit={handleSubmitRapidForm} className="rapid-quantity-form">
              {/* Activity Selector */}
              <div className="form-group">
                <label htmlFor="rapid-activity-select" className="worker-field-label">
                  <Layers size={14} />
                  <span>Activity Package</span>
                </label>
                <select
                  id="rapid-activity-select"
                  className="login-select"
                  value={selectedActivityId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedActivityId(id);
                    const act = tasks.find((t) => t.id === id);
                    if (act) {
                      setProgressPercent(String(act.actualProgress));
                    }
                  }}
                >
                  <option value="">General Project / Site Observation</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.externalId} — {t.name} ({t.location || 'Site'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Physical Target & Progress Calculation Card */}
              {activeTask && (
                <div className="task-target-metric-box">
                  <div className="metric-row">
                    <div className="metric-col">
                      <span className="sub-label">Current Progress</span>
                      <strong className="main-val">{activeTask.actualProgress}%</strong>
                    </div>

                    <div className="metric-col">
                      <span className="sub-label">Planned Target</span>
                      <strong className="main-val">
                        {activeTask.plannedQuantity ? `${activeTask.plannedQuantity} ${activeTask.unit || ''}` : 'Scope target'}
                      </strong>
                    </div>

                    <div className="metric-col highlight">
                      <span className="sub-label">New Reported</span>
                      <strong className="main-val amber">{calculatedPercent}%</strong>
                    </div>
                  </div>

                  {/* Dual Comparison Progress Bar */}
                  <div className="modal-dual-progress-bar">
                    <div
                      className="progress-fill-current"
                      style={{ width: `${Math.min(100, activeTask.actualProgress)}%` }}
                      title={`Current: ${activeTask.actualProgress}%`}
                    />
                    <div
                      className="progress-fill-new"
                      style={{ width: `${Math.min(100, calculatedPercent)}%` }}
                      title={`New: ${calculatedPercent}%`}
                    />
                  </div>
                </div>
              )}

              {/* Stepper Buttons & Numeric Inputs */}
              <div className="form-row-duo">
                <div className="form-group">
                  <label htmlFor="rapid-quantity-input" className="worker-field-label">
                    <Flame size={14} />
                    <span>Actual Completed Quantity {activeTask?.unit ? `(${activeTask.unit})` : ''}</span>
                  </label>
                  <div className="stepper-input-wrapper">
                    <input
                      id="rapid-quantity-input"
                      type="number"
                      step="any"
                      min="0"
                      className="login-input stepper-input"
                      placeholder={activeTask?.plannedQuantity ? `e.g. 80 out of ${activeTask.plannedQuantity}` : 'e.g. 80'}
                      value={actualQuantity}
                      onChange={(e) => {
                        const val = e.target.value;
                        setActualQuantity(val);
                        if (activeTask?.plannedQuantity && activeTask.plannedQuantity > 0) {
                          const n = parseFloat(val);
                          if (!isNaN(n) && n >= 0) {
                            const derived = Math.min(100, Math.round((n / activeTask.plannedQuantity) * 100));
                            setProgressPercent(String(derived));
                          }
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="rapid-percent-input" className="worker-field-label">
                    <span>Target Progress (%)</span>
                  </label>
                  <div className="stepper-input-wrapper">
                    <input
                      id="rapid-percent-input"
                      type="number"
                      min="0"
                      max="100"
                      className="login-input stepper-input"
                      placeholder="e.g. 80%"
                      value={progressPercent}
                      onChange={(e) => {
                        const val = e.target.value;
                        setProgressPercent(val);
                        if (activeTask?.plannedQuantity && activeTask.plannedQuantity > 0) {
                          const pct = parseFloat(val);
                          if (!isNaN(pct) && pct >= 0) {
                            const qty = Math.round((pct / 100) * activeTask.plannedQuantity * 10) / 10;
                            setActualQuantity(String(qty));
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Quick Stepper Buttons */}
              <div className="quick-steppers-bar">
                <span className="stepper-label">Quick Adjust:</span>
                <div className="stepper-chips">
                  <button type="button" id="stepper-minus-10" className="stepper-chip" onClick={() => handleStepPercent(-10)}>
                    -10%
                  </button>
                  <button type="button" id="stepper-minus-5" className="stepper-chip" onClick={() => handleStepPercent(-5)}>
                    -5%
                  </button>
                  <button type="button" id="stepper-plus-5" className="stepper-chip" onClick={() => handleStepPercent(5)}>
                    +5%
                  </button>
                  <button type="button" id="stepper-plus-10" className="stepper-chip" onClick={() => handleStepPercent(10)}>
                    +10%
                  </button>
                  <button type="button" id="stepper-100" className="stepper-chip complete" onClick={() => handleStepPercent(100)}>
                    100% (Complete)
                  </button>
                </div>
              </div>

              {/* Human Attribution Fields */}
              <div className="form-row-duo">
                <div className="form-group">
                  <label htmlFor="rapid-reporter-name" className="worker-field-label">
                    <User size={14} />
                    <span>Reporter Name (Attribution) *</span>
                  </label>
                  <input
                    id="rapid-reporter-name"
                    type="text"
                    className="login-input"
                    placeholder="e.g. Carlos Ramos (Lead Welder)"
                    value={reporterName}
                    onChange={(e) => setReporterName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="rapid-reporter-role" className="worker-field-label">
                    <Building size={14} />
                    <span>Reporter Role / Trade</span>
                  </label>
                  <input
                    id="rapid-reporter-role"
                    type="text"
                    className="login-input"
                    placeholder="e.g. Civil Superintendent"
                    value={reporterRole}
                    onChange={(e) => setReporterRole(e.target.value)}
                  />
                </div>
              </div>

              {/* Date & Quick Phrase Snippets */}
              <div className="form-group">
                <label htmlFor="rapid-report-date" className="worker-field-label">
                  <Calendar size={14} />
                  <span>Report Date</span>
                </label>
                <input
                  id="rapid-report-date"
                  type="date"
                  className="login-input"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  required
                />
              </div>

              {/* Quick Phrase Chips */}
              <div className="snippet-helper-section">
                <span className="snippet-label">Insert standard field phrase:</span>
                <div className="snippet-chips-row">
                  <button type="button" className="snippet-chip" onClick={() => handleAddSnippet('Concrete pour completed and finishing applied.')}>
                    + Pour completed
                  </button>
                  <button type="button" className="snippet-chip" onClick={() => handleAddSnippet('Hydrostatic testing completed at test pressure.')}>
                    + Hydrotest complete
                  </button>
                  <button type="button" className="snippet-chip" onClick={() => handleAddSnippet('Structural columns & cross beams aligned.')}>
                    + Steel erected
                  </button>
                  <button type="button" className="snippet-chip" onClick={() => handleAddSnippet('Inspection signed off by QC lead.')}>
                    + QC signoff
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div className="form-group">
                <label htmlFor="rapid-notes-input" className="worker-field-label">
                  <span>Field Observation Notes (Optional)</span>
                </label>
                <textarea
                  id="rapid-notes-input"
                  rows={2}
                  className="worker-textarea"
                  placeholder="Additional details, weather conditions, or equipment..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {/* Submit Action */}
              <button
                type="submit"
                id="submit-rapid-report-btn"
                className="btn btn-primary submit-field-report-btn"
                disabled={isSubmitting || !reporterName.trim()}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={16} className="pulse-dot" />
                    <span>Committing to Schedule Pipeline...</span>
                  </>
                ) : (
                  <>
                    <Flame size={16} />
                    <span>Commit Verified Progress ({calculatedPercent}%)</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: PHOTO CAPTURE                                                      */}
          {/* ========================================================================= */}
          {activeTab === 'photo' && (
            <form onSubmit={handleSubmitPhotoForm} className="rapid-photo-form">
              {/* Photo Input Dropzone */}
              <div className="photo-dropzone-box">
                <input
                  ref={fileInputRef}
                  id="photo-file-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden-file-input"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setPhotoFile(e.target.files[0]);
                    }
                  }}
                />

                {!photoFile ? (
                  <div
                    className="photo-placeholder-area"
                    onClick={() => fileInputRef.current?.click()}
                    tabIndex={0}
                    role="button"
                    aria-label="Tap to snap photo or select file"
                  >
                    <div className="camera-icon-bubble">
                      <Camera size={28} color="var(--accent-amber)" />
                    </div>
                    <strong>Snap Photo or Upload Field Evidence</strong>
                    <span>Camera capture supported on mobile devices</span>
                  </div>
                ) : (
                  <div className="photo-preview-card">
                    {photoPreviewUrl && (
                      <img src={photoPreviewUrl} alt="Field preview" className="photo-thumbnail" />
                    )}
                    <div className="photo-meta-bar">
                      <div className="photo-name-info">
                        <ImageIcon size={14} color="var(--accent-green)" />
                        <span className="file-name">{photoFile.name}</span>
                        <span className="file-size">({(photoFile.size / 1024).toFixed(1)} KB)</span>
                      </div>
                      <button
                        type="button"
                        id="remove-photo-btn"
                        className="remove-photo-btn"
                        onClick={() => setPhotoFile(null)}
                        title="Remove photo"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Activity Linkage */}
              <div className="form-group">
                <label htmlFor="photo-activity-select" className="worker-field-label">
                  <Layers size={14} />
                  <span>Linked Activity</span>
                </label>
                <select
                  id="photo-activity-select"
                  className="login-select"
                  value={selectedActivityId}
                  onChange={(e) => setSelectedActivityId(e.target.value)}
                >
                  <option value="">General Site / Area Evidence</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.externalId} — {t.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Human Attribution */}
              <div className="form-row-duo">
                <div className="form-group">
                  <label htmlFor="photo-reporter-name" className="worker-field-label">
                    <User size={14} />
                    <span>Reporter Name (Attribution) *</span>
                  </label>
                  <input
                    id="photo-reporter-name"
                    type="text"
                    className="login-input"
                    value={reporterName}
                    onChange={(e) => setReporterName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="photo-reporter-role" className="worker-field-label">
                    <Building size={14} />
                    <span>Reporter Role</span>
                  </label>
                  <input
                    id="photo-reporter-role"
                    type="text"
                    className="login-input"
                    value={reporterRole}
                    onChange={(e) => setReporterRole(e.target.value)}
                  />
                </div>
              </div>

              {/* Caption Notes */}
              <div className="form-group">
                <label htmlFor="photo-notes-input" className="worker-field-label">
                  <span>Photo Caption / Field Description</span>
                </label>
                <textarea
                  id="photo-notes-input"
                  rows={2}
                  className="worker-textarea"
                  placeholder="e.g. Rebar inspection prior to morning pour; concrete mixer on standby..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {/* Submit Photo Button */}
              <button
                type="submit"
                id="submit-photo-report-btn"
                className="btn btn-primary submit-field-report-btn"
                disabled={isSubmitting || !photoFile || !reporterName.trim()}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={16} className="pulse-dot" />
                    <span>Uploading & Hashing Evidence...</span>
                  </>
                ) : (
                  <>
                    <Upload size={16} />
                    <span>Upload & Attach Photo Evidence</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
