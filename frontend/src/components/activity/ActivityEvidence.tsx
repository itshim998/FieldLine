import React from 'react';
import { Paperclip, FileText, Download, ExternalLink, Calendar, HardDrive } from 'lucide-react';
import { ActivityDetailEvidence } from '../../services/activity-detail/activity-detail.types.js';

export interface ActivityEvidenceProps {
  projectId: string;
  evidence: ActivityDetailEvidence[];
}

export function ActivityEvidence({
  projectId,
  evidence
}: ActivityEvidenceProps): React.JSX.Element {
  if (!evidence || evidence.length === 0) {
    return (
      <div className="activity-evidence-card empty">
        <div className="evidence-header">
          <div className="evidence-title-group">
            <Paperclip size={18} color="var(--accent-blue)" />
            <h3 className="evidence-section-title">ORIGINATING EVIDENCE</h3>
          </div>
        </div>
        <div className="empty-evidence-state">
          <Paperclip size={24} color="var(--text-muted)" />
          <p className="empty-text">No evidence is linked to this activity.</p>
          <span className="empty-subtext">
            Evidence uploaded and confirmed through field progress reports will be traceable here.
          </span>
        </div>
      </div>
    );
  }

  const formatFileSize = (bytes: number | null) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const getFileTypeClass = (type: string) => {
    switch (type.toLowerCase()) {
      case 'pdf':
        return 'type-pdf';
      case 'xlsx':
      case 'csv':
        return 'type-xlsx';
      case 'image':
        return 'type-image';
      case 'text':
      default:
        return 'type-text';
    }
  };

  return (
    <div className="activity-evidence-card">
      <div className="evidence-header">
        <div className="evidence-title-group">
          <Paperclip size={18} color="var(--accent-blue)" />
          <h3 className="evidence-section-title">ORIGINATING EVIDENCE</h3>
          <span className="evidence-count-badge">
            {evidence.length} {evidence.length === 1 ? 'File' : 'Files'}
          </span>
        </div>
      </div>

      <div className="evidence-items-grid">
        {evidence.map((item) => (
          <div key={item.evidenceId} className="detail-evidence-card">
            <div className="evidence-card-top">
              <div className={`file-icon-badge ${getFileTypeClass(item.fileType)}`}>
                <FileText size={16} />
              </div>
              <div className="evidence-file-info">
                <span className="evidence-filename" title={item.fileName}>
                  {item.fileName}
                </span>
                <div className="evidence-file-meta">
                  <span>{formatFileSize(item.fileSizeBytes)}</span>
                  <span>&bull;</span>
                  <span>{item.fileType.toUpperCase()}</span>
                </div>
              </div>
            </div>

            <div className="evidence-card-bottom">
              <div className="evidence-uploaded-date">
                <Calendar size={11} />
                <span>Uploaded: {new Date(item.uploadedAt).toLocaleDateString()}</span>
              </div>

              <a
                href={`/api/projects/${projectId}/evidence/${item.evidenceId}/content`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm evidence-open-btn"
                title="Open evidence file securely"
              >
                <ExternalLink size={12} />
                <span>View</span>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
