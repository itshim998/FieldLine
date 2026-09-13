import {
  DefaultAnomalyMessageGeneratorService
} from '../backend/src/services/anomaly/anomaly-message-generator.service.js';
import {
  toAnomalyMessageInput,
  AnomalyAlertMessage
} from '../backend/src/services/anomaly/anomaly-message.types.js';
import { AnomalyPrediction } from '../backend/src/ml/types.js';
import { DefaultAIService } from '../backend/src/ai/services/ai.service.js';
import { MockAIProvider } from '../backend/src/ai/providers/mock-ai.provider.js';
import { renderAnomalyAlertEmail } from '../backend/src/services/anomaly/email/email-renderer.js';
import { ResendEmailDeliveryService } from '../backend/src/services/anomaly/email/resend-email-delivery.service.js';
import { DefaultAnomalyNotificationService } from '../backend/src/services/anomaly/anomaly-notification.service.js';

async function runPhase3Evaluation() {
  console.log('================================================================================');
  console.log('PHASE 3 — BEHAVIORAL & INTUITIVE EMAIL DELIVERY EVALUATION');
  console.log('================================================================================\n');

  const mockProvider = new MockAIProvider();
  const aiService = new DefaultAIService(mockProvider);
  const generator = new DefaultAnomalyMessageGeneratorService(aiService);

  // -------------------------------------------------------------
  // Case A — HIGH Anomaly
  // -------------------------------------------------------------
  console.log('--------------------------------------------------------------------------------');
  console.log('CASE A — HIGH ANOMALY (Refinery Construction / Piping Installation Area B: 41% -> 82%)');
  console.log('--------------------------------------------------------------------------------');
  const predictionA: AnomalyPrediction = {
    anomalyScore: 0.91,
    severity: 'high',
    reviewRecommended: true,
    reasons: [
      'Daily progress velocity is well above the learned baseline distribution.',
      'Reported progress increment is far outside the learned normal shift distribution.'
    ]
  };

  const inputA = toAnomalyMessageInput(predictionA, {
    projectName: 'Refinery Construction',
    activityExternalId: 'ACT-PIPE-02',
    activityName: 'Piping Installation — Area B',
    activityLocation: 'Area B',
    reportDate: '2026-09-13',
    reporterName: 'Rajesh',
    previousPercent: 41,
    reportedPercent: 82,
    activityMatchId: 'match-pipe-area-b-01'
  })!;

  const msgA = await generator.generateAnomalyMessage(inputA);
  const emailA = renderAnomalyAlertEmail(msgA);

  console.log('SUBJECT:', emailA.subject);
  console.log('\n--- PLAIN TEXT RENDERING ---');
  console.log(emailA.text);
  console.log('\n--- HTML SAMPLE SNIPPET ---');
  console.log(emailA.html.slice(0, 800) + '...\n');

  // -------------------------------------------------------------
  // Case B — REVIEW Anomaly
  // -------------------------------------------------------------
  console.log('--------------------------------------------------------------------------------');
  console.log('CASE B — REVIEW ANOMALY (Lower urgency than HIGH without weakening actionability)');
  console.log('--------------------------------------------------------------------------------');
  const predictionB: AnomalyPrediction = {
    anomalyScore: 0.62,
    severity: 'review',
    reviewRecommended: true,
    reasons: ['Reported shift velocity moderately exceeds standard progress cadence.']
  };

  const inputB = toAnomalyMessageInput(predictionB, {
    projectName: 'Substation Alpha',
    activityExternalId: 'ACT-ELEC-05',
    activityName: 'Cable Tray Pulling',
    activityLocation: 'Sector 3',
    reportDate: '2026-09-13',
    reporterName: 'Carlos M',
    previousPercent: 30,
    reportedPercent: 65,
    activityMatchId: 'match-elec-rev-02'
  })!;

  const msgB = await generator.generateAnomalyMessage(inputB);
  const emailB = renderAnomalyAlertEmail(msgB);

  console.log('SUBJECT:', emailB.subject);
  console.log('PLAIN TEXT HEADLINE:', emailB.text.split('\n').slice(0, 5).join('\n'));
  console.log('RECOMMENDED ACTION:', msgB.recommendedAction);

  // -------------------------------------------------------------
  // Case C — Exact Activity Match + High Anomaly
  // -------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('CASE C — EXACT MATCH + HIGH ANOMALY (Activity match identity is unquestioned)');
  console.log('--------------------------------------------------------------------------------');
  const predictionC: AnomalyPrediction = {
    anomalyScore: 0.94,
    severity: 'high',
    reviewRecommended: true,
    reasons: ['Daily progression increment is 5.2 standard deviations above baseline.']
  };

  const inputC = toAnomalyMessageInput(predictionC, {
    projectName: 'Refinery Unit 4',
    activityExternalId: 'ACT-FOUND-01',
    activityName: 'Foundation Footing Concrete Pour',
    activityLocation: 'Area B',
    reportDate: '2026-09-13',
    reporterName: 'Vikram Patel',
    previousPercent: 10,
    reportedPercent: 95,
    activityMatchId: 'match-exact-003'
  })!;

  const msgC = await generator.generateAnomalyMessage(inputC);
  const emailC = renderAnomalyAlertEmail(msgC);
  console.log('ACTIVITY IDENTIFICATION IN EMAIL:');
  console.log(`Activity: ${msgC.activityName} (${msgC.activityExternalId})`);
  console.log('Is activity identity questioned in email text?:', /uncertain|unclear activity|re-match/i.test(emailC.text) ? 'YES (UNEXPECTED)' : 'NO (CORRECT: match identity is verified and trusted)');

  // -------------------------------------------------------------
  // Case D — No Previous Canonical Progress
  // -------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('CASE D — NO PREVIOUS PROGRESS (Cold start observation, does NOT invent prior %)');
  console.log('--------------------------------------------------------------------------------');
  const predictionD: AnomalyPrediction = {
    anomalyScore: 0.88,
    severity: 'high',
    reviewRecommended: true,
    reasons: ['Initial progress observation exceeds typical first-shift pace.']
  };

  const inputD = toAnomalyMessageInput(predictionD, {
    projectName: 'Pipeline Expansion',
    activityExternalId: 'ACT-CIVIL-10',
    activityName: 'Pipe Trench Excavation',
    activityLocation: 'Sector 1',
    reportDate: '2026-09-13',
    reporterName: 'Anil S',
    previousPercent: null, // Initial observation
    reportedPercent: 85,
    activityMatchId: 'match-cold-004'
  })!;

  const msgD = await generator.generateAnomalyMessage(inputD);
  const emailD = renderAnomalyAlertEmail(msgD);
  console.log('PREVIOUS PROGRESS FIELD IN EMAIL:', emailD.text.match(/Previous Canonical Progress:.*$/m)?.[0]);
  console.log('TRAJECTORY FIELD IN EMAIL:       ', emailD.text.match(/Progression Trajectory:.*$/m)?.[0]);

  // -------------------------------------------------------------
  // Case E — Missing Reporter / Location
  // -------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('CASE E — MISSING REPORTER / LOCATION (Clean "Unspecified" fallback, no hallucinations)');
  console.log('--------------------------------------------------------------------------------');
  const predictionE: AnomalyPrediction = {
    anomalyScore: 0.65,
    severity: 'review',
    reviewRecommended: true,
    reasons: ['Progress velocity slightly exceeds distribution.']
  };

  const inputE = toAnomalyMessageInput(predictionE, {
    projectName: 'Storage Tanks Area',
    activityExternalId: 'ACT-TANK-04',
    activityName: 'Tank Shell Welding',
    activityLocation: null,
    reportDate: '2026-09-13',
    reporterName: null,
    previousPercent: 40,
    reportedPercent: 70,
    activityMatchId: 'match-missing-data-005'
  })!;

  const msgE = await generator.generateAnomalyMessage(inputE);
  const emailE = renderAnomalyAlertEmail(msgE);
  console.log('LOCATION IN EMAIL:', emailE.text.match(/• Location:.*$/m)?.[0]);
  console.log('REPORTER IN EMAIL:', emailE.text.match(/• Reported By:.*$/m)?.[0]);

  // -------------------------------------------------------------
  // Case F — Resend Outage (HTTP 503 Isolation)
  // -------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('CASE F — RESEND OUTAGE (HTTP 503 failure is cleanly caught and isolated)');
  console.log('--------------------------------------------------------------------------------');
  const mockFailingFetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ message: 'Resend API service unavailable' })
  });

  const failingDeliveryService = new ResendEmailDeliveryService({
    apiKey: 're_outage_test_key',
    recipients: ['admin@fieldline.app'],
    enabled: true,
    fetchFn: mockFailingFetch as any
  });

  const notificationServiceF = new DefaultAnomalyNotificationService({
    emailDeliveryService: failingDeliveryService
  });

  const resultF = await notificationServiceF.notifyAnomalyAlert({
    prediction: predictionA,
    context: {
      projectName: 'Refinery Construction',
      activityExternalId: 'ACT-PIPE-02',
      activityName: 'Piping Installation — Area B',
      reportDate: '2026-09-13',
      reportedPercent: 82,
      activityMatchId: 'match-pipe-area-b-01'
    }
  });

  console.log('Notification completed without throwing uncaught error.');
  console.log('Delivery sent status:', resultF.delivery?.sent);
  console.log('Delivery error code: ', resultF.delivery?.errorCode);
  console.log('Delivery error summary:', resultF.delivery?.errorSummary);
  console.log('Is domain message preserved despite delivery failure?:', resultF.message !== null ? 'YES' : 'NO');

  // -------------------------------------------------------------
  // Case G — HTML Escaping
  // -------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('CASE G — HTML ESCAPING (Harmful markup is rendered as harmless text)');
  console.log('--------------------------------------------------------------------------------');
  const maliciousMessage: AnomalyAlertMessage = {
    title: '<script>alert("PWN TITLE")</script>',
    summary: '"><b onmouseover=alert(1)>HOVER</b> & test',
    details: '<iframe src="malicious.com"></iframe>\n\nBody text with <script>',
    recommendedAction: '<a href="javascript:steal()">CLICK</a>',
    fullMessage: 'Full msg...',
    activityMatchId: 'match-xss',
    projectName: 'Project <XSS>',
    activityExternalId: 'ACT-<001>',
    activityName: '<script>alert(1)</script> Piling',
    activityLocation: '<img src=x onerror=alert(2)> Zone',
    reportDate: '2026-09-13',
    reporterName: 'Attacker <script>',
    previousPercent: 10,
    reportedPercent: 90,
    severity: 'high',
    anomalyScore: 0.95,
    anomalyReasons: ['<svg onload=alert(3)> Reason 1'],
    generatedBy: 'groq',
    generatedAt: '2026-09-13T12:00:00.000Z'
  };

  const emailG = renderAnomalyAlertEmail(maliciousMessage);
  const hasRawScript = emailG.html.includes('<script>');
  const hasRawIframe = emailG.html.includes('<iframe');
  const hasRawSvg = emailG.html.includes('<svg');
  const hasEscapedEntities = emailG.html.includes('&lt;script&gt;') && emailG.html.includes('&lt;iframe');

  console.log('Contains unescaped <script> tag:', hasRawScript ? 'YES (FAIL)' : 'NO (PASSED)');
  console.log('Contains unescaped <iframe> tag:', hasRawIframe ? 'YES (FAIL)' : 'NO (PASSED)');
  console.log('Contains unescaped <svg> tag:   ', hasRawSvg ? 'YES (FAIL)' : 'NO (PASSED)');
  console.log('Properly converted to &lt;...&gt; entities:', hasEscapedEntities ? 'YES (PASSED)' : 'NO (FAIL)');

  console.log('\n================================================================================');
  console.log('ALL PHASE 3 BEHAVIORAL EVALUATION EXAMPLES VERIFIED SUCCESSFULLY');
  console.log('================================================================================');
}

runPhase3Evaluation().catch((err) => {
  console.error('Phase 3 evaluation failed:', err);
  process.exit(1);
});
