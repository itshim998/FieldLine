import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  renderAnomalyAlertEmail
} from '../src/services/anomaly/email/email-renderer.js';
import type { AnomalyAlertMessage } from '../src/services/anomaly/anomaly-message.types.js';

describe('Phase 3 — Deterministic Email Renderer & HTML Safety', () => {
  it('1. escapeHtml rigorously neutralizes HTML special characters', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('Normal text 123')).toBe('Normal text 123');
    expect(escapeHtml('<script>alert("XSS")</script>')).toBe(
      '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
    );
    expect(escapeHtml("Tom's & Jerry's > Cat & Mouse <")).toBe(
      'Tom&#39;s &amp; Jerry&#39;s &gt; Cat &amp; Mouse &lt;'
    );
    expect(escapeHtml('"><img src=x onerror=alert(1)>')).toBe(
      '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'
    );
  });

  it('2. Case A — HIGH anomaly rendering conveys urgency, exact trajectory, and factual accuracy', () => {
    const message: AnomalyAlertMessage = {
      title: '[FieldLine Alert] HIGH: Piping Installation — Area B (ACT-PIPE-02) Progress Deviation',
      summary:
        'A reported progress of 82% for Piping Installation — Area B (ACT-PIPE-02) has been flagged with HIGH statistical deviation from historical progression baselines.',
      details:
        'Project: Refinery Construction\nActivity: Piping Installation — Area B (ACT-PIPE-02)\nLocation: Area B\nReported By: Rajesh Kumar\nReport Date: 2026-09-13\nPrevious Canonical Progress: 41%\nReported Progress: 82%\nProgression Trajectory: Progress shifted from 41% to 82% (net increment: 41%).\nStatistical Anomaly Score: 91% deviation from learned baseline (HIGH)\nStatistical Observations:\n• Daily progress velocity is well above the learned baseline distribution.\n• Reported progress increment is far outside the learned normal shift distribution.',
      recommendedAction:
        'Conduct an immediate on-site physical inspection to verify actual installation progress and review supporting field documentation before canonical sign-off.',
      fullMessage: 'Full alert message content...',
      activityMatchId: 'match-high-12345',
      projectName: 'Refinery Construction',
      activityExternalId: 'ACT-PIPE-02',
      activityName: 'Piping Installation — Area B',
      activityLocation: 'Area B',
      reportDate: '2026-09-13',
      reporterName: 'Rajesh Kumar',
      previousPercent: 41,
      reportedPercent: 82,
      severity: 'high',
      anomalyScore: 0.91,
      anomalyReasons: [
        'Daily progress velocity is well above the learned baseline distribution.',
        'Reported progress increment is far outside the learned normal shift distribution.'
      ],
      generatedBy: 'groq',
      generatedAt: '2026-09-13T10:30:00.000Z'
    };

    const rendered = renderAnomalyAlertEmail(message);

    // Subject
    expect(rendered.subject).toBe(
      '[FieldLine Alert] HIGH: Piping Installation — Area B (ACT-PIPE-02) Progress Deviation'
    );

    // Plaintext assertions
    expect(rendered.text).toContain('FIELDLINE OPERATIONAL ANOMALY ALERT — HIGH');
    expect(rendered.text).toContain('Refinery Construction');
    expect(rendered.text).toContain('ACT-PIPE-02');
    expect(rendered.text).toContain('41%');
    expect(rendered.text).toContain('82%');
    expect(rendered.text).toContain('91% (0.91)');
    expect(rendered.text).toContain('Rajesh Kumar');
    expect(rendered.text).toContain('match-high-12345');
    expect(rendered.text).toContain('Daily progress velocity is well above the learned baseline distribution.');

    // HTML assertions
    expect(rendered.html).toContain('HIGH SEVERITY');
    expect(rendered.html).toContain('#dc2626'); // High severity badge color
    expect(rendered.html).toContain('Refinery Construction');
    expect(rendered.html).toContain('ACT-PIPE-02');
    expect(rendered.html).toContain('41% → 82% (net increment: 41%)');
    expect(rendered.html).toContain('91% (0.91)');
    expect(rendered.html).toContain('match-high-12345');
    expect(rendered.html).toContain('Conduct an immediate on-site physical inspection');
  });

  it('3. Case B — REVIEW anomaly renders lower urgency without weakening actionability', () => {
    const message: AnomalyAlertMessage = {
      title: '[FieldLine Alert] REVIEW: Cable Tray Pulling (ACT-ELEC-05) Progress Deviation',
      summary:
        'A progress report of 65% for Cable Tray Pulling (ACT-ELEC-05) shows elevated statistical deviation requiring supervisor review.',
      details: 'Progression pace is elevated relative to baseline pacing.',
      recommendedAction:
        'Review reported progress against recent field logs and verify completion status with the site supervisor before confirming.',
      fullMessage: 'Full alert message content...',
      activityMatchId: 'match-review-67890',
      projectName: 'Substation Alpha',
      activityExternalId: 'ACT-ELEC-05',
      activityName: 'Cable Tray Pulling',
      activityLocation: 'Sector 3',
      reportDate: '2026-09-13',
      reporterName: 'Carlos M',
      previousPercent: 30,
      reportedPercent: 65,
      severity: 'review',
      anomalyScore: 0.62,
      anomalyReasons: ['Daily progression velocity is moderately outside historical baseline.'],
      generatedBy: 'deterministic_fallback',
      generatedAt: '2026-09-13T11:00:00.000Z'
    };

    const rendered = renderAnomalyAlertEmail(message);

    expect(rendered.subject).toContain('[FieldLine Alert] REVIEW:');
    expect(rendered.html).toContain('REVIEW SEVERITY');
    expect(rendered.html).toContain('#d97706'); // Amber for review
    expect(rendered.text).toContain('FIELDLINE OPERATIONAL ANOMALY ALERT — REVIEW');
    expect(rendered.html).toContain('62% (0.62)');
    expect(rendered.html).toContain('Review reported progress against recent field logs');
  });

  it('4. Case C — Exact activity match + high anomaly preserves activity certainty', () => {
    const message: AnomalyAlertMessage = {
      title: '[FieldLine Alert] HIGH: Foundation Footing Concrete Pour (ACT-FOUND-01) Progress Deviation',
      summary: 'Reported progress shows extreme statistical variance from baseline.',
      details: 'Details...',
      recommendedAction: 'Inspect on site.',
      fullMessage: 'Message...',
      activityMatchId: 'match-exact-999',
      projectName: 'Refinery Unit 4',
      activityExternalId: 'ACT-FOUND-01',
      activityName: 'Foundation Footing Concrete Pour',
      activityLocation: 'Area B',
      reportDate: '2026-09-13',
      reporterName: 'Vikram Patel',
      previousPercent: 10,
      reportedPercent: 95,
      severity: 'high',
      anomalyScore: 0.94,
      anomalyReasons: ['Shift velocity deviates 5.2 standard deviations above baseline.'],
      generatedBy: 'groq',
      generatedAt: '2026-09-13T11:15:00.000Z'
    };

    const rendered = renderAnomalyAlertEmail(message);

    // Verified that activity identity is cleanly stated and not questioned
    expect(rendered.html).toContain('Foundation Footing Concrete Pour');
    expect(rendered.html).toContain('ACT-FOUND-01');
    expect(rendered.html).not.toMatch(/wrong activity|re-match|uncertain identity/i);
    expect(rendered.text).not.toMatch(/wrong activity|re-match|uncertain identity/i);
  });

  it('5. Case D — No previous canonical progress does NOT invent prior percentage', () => {
    const message: AnomalyAlertMessage = {
      title: '[FieldLine Alert] HIGH: Pipe Trench Excavation (ACT-CIVIL-10) Progress Deviation',
      summary: 'Initial recorded progress observation shows statistical anomaly.',
      details: 'Details...',
      recommendedAction: 'Verify in field.',
      fullMessage: 'Message...',
      activityMatchId: 'match-cold-001',
      projectName: 'Pipeline Expansion',
      activityExternalId: 'ACT-CIVIL-10',
      activityName: 'Pipe Trench Excavation',
      activityLocation: 'Sector 1',
      reportDate: '2026-09-13',
      reporterName: 'Anil S',
      previousPercent: null, // Initial observation
      reportedPercent: 85,
      severity: 'high',
      anomalyScore: 0.88,
      anomalyReasons: ['Initial progress observation exceeds typical first-shift pace.'],
      generatedBy: 'groq',
      generatedAt: '2026-09-13T11:30:00.000Z'
    };

    const rendered = renderAnomalyAlertEmail(message);

    // Must gracefully state no previous progress recorded without inventing e.g. 0% -> 85% (+85%)
    expect(rendered.text).toContain('Previous Canonical Progress: None recorded (baseline pace evaluation)');
    expect(rendered.text).toContain('Initial recorded progress observation of 85% (no prior canonical progress recorded)');
    expect(rendered.html).toContain('None recorded (baseline pace evaluation)');
    expect(rendered.html).toContain('Initial recorded progress observation of 85% (no prior canonical progress recorded)');
    expect(rendered.html).not.toContain('null%');
    expect(rendered.html).not.toContain('undefined%');
  });

  it('6. Case E — Missing reporter and location gracefully fall back to "Unspecified"', () => {
    const message: AnomalyAlertMessage = {
      title: '[FieldLine Alert] REVIEW: Structural Steel Erection (ACT-STEEL-03) Progress Deviation',
      summary: 'Progress deviation detected.',
      details: 'Details...',
      recommendedAction: 'Verify in field.',
      fullMessage: 'Message...',
      activityMatchId: null,
      projectName: 'Industrial Facility',
      activityExternalId: 'ACT-STEEL-03',
      activityName: 'Structural Steel Erection',
      activityLocation: null,
      reportDate: '2026-09-13',
      reporterName: null,
      previousPercent: 50,
      reportedPercent: 75,
      severity: 'review',
      anomalyScore: 0.58,
      anomalyReasons: ['Daily increment slightly above distribution.'],
      generatedBy: 'deterministic_fallback',
      generatedAt: '2026-09-13T11:45:00.000Z'
    };

    const rendered = renderAnomalyAlertEmail(message);

    expect(rendered.text).toContain('• Location:                    Unspecified');
    expect(rendered.text).toContain('• Reported By:                 Unspecified');
    expect(rendered.html).toContain('Unspecified');
    expect(rendered.html).not.toContain('null');
    expect(rendered.html).not.toContain('undefined');
  });

  it('7. Case G — HTML Injection Safety: Untrusted inputs are strictly escaped into plain character entities', () => {
    const message: AnomalyAlertMessage = {
      title: '<script>alert("PWN TITLE")</script>',
      summary: '"><b onmouseover=alert(1)>HOVER ME</b> & special chars',
      details: '<iframe src="evil.com"></iframe>\n\n<style>body { display: none; }</style>',
      recommendedAction: '<a href="javascript:alert(2)">CLICK HERE</a>',
      fullMessage: 'Raw full message with <script>',
      activityMatchId: 'match-"xss"',
      projectName: 'Dangerous <Project> & "Co"',
      activityExternalId: 'ACT-<INJECT>-01',
      activityName: '<b>Bold Activity</b>',
      activityLocation: 'Pier 5\'"><script>alert(3)</script>',
      reportDate: '2026-09-13',
      reporterName: 'Worker <Hack> "O\'Brian"',
      previousPercent: 20,
      reportedPercent: 70,
      severity: 'high',
      anomalyScore: 0.85,
      anomalyReasons: [
        '<img src=x onerror=alert("REASON_XSS")>',
        'Second reason with <strong>markup</strong> & symbols'
      ],
      generatedBy: 'groq',
      generatedAt: '2026-09-13T12:00:00.000Z'
    };

    const rendered = renderAnomalyAlertEmail(message);

    // Assert that malicious tags DO NOT exist unescaped in HTML
    expect(rendered.html).not.toContain('<script>alert("PWN TITLE")</script>');
    expect(rendered.html).not.toContain('<iframe src="evil.com">');
    expect(rendered.html).not.toContain('<style>body { display: none; }</style>');
    expect(rendered.html).not.toContain('<a href="javascript:alert(2)">');
    expect(rendered.html).not.toContain('<b onmouseover=alert(1)>');
    expect(rendered.html).not.toContain('<b>Bold Activity</b>');
    expect(rendered.html).not.toContain('<img src=x onerror=alert("REASON_XSS")>');

    // Assert that properly escaped HTML entities DO exist
    expect(rendered.html).toContain('&lt;script&gt;alert(&quot;PWN TITLE&quot;)&lt;/script&gt;');
    expect(rendered.html).toContain('&lt;b&gt;Bold Activity&lt;/b&gt;');
    expect(rendered.html).toContain('&lt;iframe src=&quot;evil.com&quot;&gt;&lt;/iframe&gt;');
    expect(rendered.html).toContain('Pier 5&#39;&quot;&gt;&lt;script&gt;alert(3)&lt;/script&gt;');
    expect(rendered.html).toContain('Worker &lt;Hack&gt; &quot;O&#39;Brian&quot;');
    expect(rendered.html).toContain('Dangerous &lt;Project&gt; &amp; &quot;Co&quot;');
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(&quot;REASON_XSS&quot;)&gt;');
  });
});
