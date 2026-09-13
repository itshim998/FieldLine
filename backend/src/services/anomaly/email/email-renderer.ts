import type { AnomalyAlertMessage } from '../anomaly-message.types.js';

/**
 * Escapes dynamic and untrusted text for safe HTML interpolation.
 * Strictly neutralizes characters that could introduce markup or script execution.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats multiline plain text into escaped HTML paragraphs and line breaks.
 */
export function formatMultilineHtml(text: string): string {
  if (!text) return '';
  return escapeHtml(text)
    .split(/\r?\n\r?\n/)
    .map((para) => `<p style="margin: 0 0 12px 0; line-height: 1.6;">${para.replace(/\r?\n/g, '<br/>')}</p>`)
    .join('');
}

export interface RenderedAnomalyAlertEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Deterministically renders an AnomalyAlertMessage into HTML and plaintext formats.
 * Preserves the server-owned anomaly truth and ensures complete HTML safety.
 */
export function renderAnomalyAlertEmail(message: AnomalyAlertMessage): RenderedAnomalyAlertEmail {
  const isHigh = message.severity === 'high';
  const sevLabel = isHigh ? 'HIGH' : 'REVIEW';
  const subject = `[FieldLine Alert] ${sevLabel}: ${message.activityName} (${message.activityExternalId}) Progress Deviation`;

  const scorePct = Math.round(message.anomalyScore * 100);
  const scoreDisplay = `${scorePct}% (${message.anomalyScore.toFixed(2)})`;

  const previousProgressText =
    message.previousPercent !== null && message.previousPercent !== undefined
      ? `${message.previousPercent}%`
      : 'None recorded (baseline pace evaluation)';

  const reportedProgressText = `${message.reportedPercent}%`;

  const trajectoryText =
    message.previousPercent !== null && message.previousPercent !== undefined
      ? `${message.previousPercent}% → ${message.reportedPercent}% (net increment: ${message.reportedPercent - message.previousPercent}%)`
      : `Initial recorded progress observation of ${message.reportedPercent}% (no prior canonical progress recorded)`;

  const locationText = message.activityLocation ? message.activityLocation : 'Unspecified';
  const reporterText = message.reporterName ? message.reporterName : 'Unspecified';
  const correlationIdText = message.activityMatchId ? message.activityMatchId : 'unlinked';

  // 1. Deterministic Plaintext Rendering
  const textReasons =
    message.anomalyReasons && message.anomalyReasons.length > 0
      ? message.anomalyReasons.map((r, i) => `  ${i + 1}. ${r}`).join('\n')
      : '  1. Progression rate deviates substantially from the learned statistical baseline.';

  const textLines: string[] = [
    '================================================================================',
    `FIELDLINE OPERATIONAL ANOMALY ALERT — ${sevLabel}`,
    '================================================================================',
    '',
    `ALERT: ${message.title}`,
    '',
    'EXECUTIVE SUMMARY:',
    message.summary,
    '',
    'OPERATIONAL CONTEXT & SERVER-VERIFIED FACTS:',
    `• Project:                     ${message.projectName}`,
    `• Activity External ID:        ${message.activityExternalId}`,
    `• Activity Name:               ${message.activityName}`,
    `• Location:                    ${locationText}`,
    `• Reported By:                 ${reporterText}`,
    `• Report Date:                 ${message.reportDate}`,
    `• Previous Canonical Progress: ${previousProgressText}`,
    `• Reported Progress:           ${reportedProgressText}`,
    `• Progression Trajectory:      ${trajectoryText}`,
    `• Anomaly Severity:            ${sevLabel}`,
    `• Statistical Anomaly Score:   ${scoreDisplay}`,
    '',
    'STATISTICAL OBSERVATIONS:',
    textReasons,
    '',
    'TECHNICAL DETAILS:',
    message.details,
    '',
    'RECOMMENDED SUPERVISOR ACTION:',
    message.recommendedAction,
    '',
    '--------------------------------------------------------------------------------',
    `Correlation ID: ${correlationIdText} | Engine: ${message.generatedBy} | Generated: ${message.generatedAt}`,
    'This is an automated operational alert dispatched by FieldLine ML Risk Intelligence.'
  ];
  const text = textLines.join('\n');

  // 2. Deterministic HTML Rendering with Strict Escaping
  const sevBadgeBg = isHigh ? '#dc2626' : '#d97706';
  const sevBorderColor = isHigh ? '#b91c1c' : '#b45309';
  const sevLightBg = isHigh ? '#fef2f2' : '#fffbeb';

  const htmlReasons =
    message.anomalyReasons && message.anomalyReasons.length > 0
      ? message.anomalyReasons
          .map(
            (r) =>
              `<li style="margin-bottom: 6px; color: #374151; font-size: 14px; line-height: 1.5;">${escapeHtml(r)}</li>`
          )
          .join('')
      : '<li style="margin-bottom: 6px; color: #374151; font-size: 14px;">Progression rate deviates substantially from the learned statistical baseline.</li>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; color: #1f2937;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f3f4f6; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="640" cellpadding="0" cellspacing="0" border="0" style="max-width: 640px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
          
          <!-- Header Bar -->
          <tr>
            <td style="background-color: #0f172a; padding: 20px 24px; text-align: left;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="color: #60a5fa; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;">FIELDLINE OPERATIONAL ALERT</span>
                    <h1 style="margin: 4px 0 0 0; color: #ffffff; font-size: 18px; font-weight: 700; line-height: 1.3;">Field Progress Anomaly Detected</h1>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <span style="display: inline-block; padding: 4px 12px; border-radius: 9999px; background-color: ${sevBadgeBg}; color: #ffffff; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;">${sevLabel} SEVERITY</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Alert Banner -->
          <tr>
            <td style="padding: 24px 24px 16px 24px;">
              <div style="background-color: ${sevLightBg}; border-left: 4px solid ${sevBorderColor}; padding: 14px 16px; border-radius: 4px; margin-bottom: 20px;">
                <h2 style="margin: 0 0 6px 0; color: #111827; font-size: 16px; font-weight: 700;">${escapeHtml(message.title)}</h2>
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.5;">${escapeHtml(message.summary)}</p>
              </div>

              <!-- Key Facts Table -->
              <h3 style="margin: 20px 0 10px 0; color: #0f172a; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Authoritative Fact Breakdown</h3>
              <table width="100%" cellpadding="8" cellspacing="0" border="0" style="border: 1px solid #e5e7eb; border-radius: 6px; border-collapse: collapse; font-size: 13px;">
                <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <td style="width: 35%; font-weight: 600; color: #4b5563;">Project</td>
                  <td style="color: #111827; font-weight: 600;">${escapeHtml(message.projectName)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="font-weight: 600; color: #4b5563;">Activity</td>
                  <td style="color: #111827;"><strong>${escapeHtml(message.activityName)}</strong> <span style="color: #6b7280; font-family: monospace;">(${escapeHtml(message.activityExternalId)})</span></td>
                </tr>
                <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <td style="font-weight: 600; color: #4b5563;">Location</td>
                  <td style="color: #111827;">${escapeHtml(locationText)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="font-weight: 600; color: #4b5563;">Reported By</td>
                  <td style="color: #111827;">${escapeHtml(reporterText)}</td>
                </tr>
                <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <td style="font-weight: 600; color: #4b5563;">Observation Date</td>
                  <td style="color: #111827;">${escapeHtml(message.reportDate)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="font-weight: 600; color: #4b5563;">Previous Canonical Progress</td>
                  <td style="color: #111827;">${escapeHtml(previousProgressText)}</td>
                </tr>
                <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <td style="font-weight: 600; color: #4b5563;">Reported Progress</td>
                  <td style="color: #111827; font-weight: 700;">${escapeHtml(reportedProgressText)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="font-weight: 600; color: #4b5563;">Progression Trajectory</td>
                  <td style="color: #111827;">${escapeHtml(trajectoryText)}</td>
                </tr>
                <tr style="background-color: #f9fafb;">
                  <td style="font-weight: 600; color: #4b5563;">Statistical Anomaly Score</td>
                  <td style="color: ${sevBadgeBg}; font-weight: 700;">${escapeHtml(scoreDisplay)}</td>
                </tr>
              </table>

              <!-- Statistical Reasons -->
              <h3 style="margin: 24px 0 10px 0; color: #0f172a; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Statistical Observations</h3>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 18px 8px 18px;">
                <ul style="margin: 0; padding-left: 20px;">
                  ${htmlReasons}
                </ul>
              </div>

              <!-- Technical Details -->
              <h3 style="margin: 24px 0 10px 0; color: #0f172a; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Operational Context</h3>
              <div style="color: #374151; font-size: 14px;">
                ${formatMultilineHtml(message.details)}
              </div>

              <!-- Recommended Action Callout -->
              <div style="margin: 24px 0 12px 0; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 16px;">
                <h4 style="margin: 0 0 6px 0; color: #1e40af; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Recommended Supervisor Action</h4>
                <p style="margin: 0; color: #1e3a8a; font-size: 14px; line-height: 1.5; font-weight: 500;">${escapeHtml(message.recommendedAction)}</p>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; border-top: 1px solid #e5e7eb; padding: 16px 24px; font-size: 12px; color: #6b7280; text-align: center;">
              <p style="margin: 0 0 4px 0;">Correlation ID: <span style="font-family: monospace; color: #374151;">${escapeHtml(correlationIdText)}</span> | Engine: ${escapeHtml(message.generatedBy)}</p>
              <p style="margin: 0;">Dispatched by FieldLine ML Risk Intelligence as of ${escapeHtml(message.generatedAt)}.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject,
    html,
    text
  };
}
