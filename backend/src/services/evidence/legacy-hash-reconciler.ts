import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  EvidenceRepository,
  evidenceRepository as defaultEvidenceRepo
} from '../../repositories/evidence.repository.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { MaybePromise } from '../../database/provider.js';

export interface ReconciliationSummary {
  totalLegacyFound: number;
  reconciledCount: number;
  unresolvedCount: number;
}

/**
 * Reconciles legacy evidence rows that do not yet have a content SHA-256 hash.
 * Safely resolves the stored physical file bytes and computes the true cryptographic digest.
 * If the physical file is missing or unreadable, NEVER fabricates a synthetic hash.
 */
export function reconcileLegacyEvidenceHashes(
  evidenceRepo: EvidenceRepository = defaultEvidenceRepo,
  uploadDir: string = env.UPLOAD_DIR
): MaybePromise<ReconciliationSummary> {
  const legacyRowsRes = evidenceRepo.listUnreconciledLegacyEvidence();

  if (legacyRowsRes instanceof Promise) {
    return legacyRowsRes.then(async (legacyRows) => {
      if (legacyRows.length === 0) {
        return {
          totalLegacyFound: 0,
          reconciledCount: 0,
          unresolvedCount: 0
        };
      }

      logger.info(`LegacyHashReconciler: Found ${legacyRows.length} legacy evidence rows without content hashes. Beginning reconciliation...`);

      let reconciledCount = 0;
      let unresolvedCount = 0;

      for (const item of legacyRows) {
        try {
          const projectRoot = path.resolve(process.cwd(), uploadDir, item.projectId);
          const resolvedPath = path.resolve(process.cwd(), uploadDir, item.filePath);

          if (!resolvedPath.startsWith(projectRoot)) {
            logger.warn(
              `LegacyHashReconciler: Path traversal or invalid location for evidence ${item.id} (${item.filePath}). Leaving hash unresolved.`
            );
            unresolvedCount++;
            continue;
          }

          if (!fs.existsSync(resolvedPath)) {
            logger.warn(
              `LegacyHashReconciler: Physical file missing on disk for legacy evidence ${item.id} (${item.filePath}). Leaving hash unresolved.`
            );
            unresolvedCount++;
            continue;
          }

          const fileBuffer = fs.readFileSync(resolvedPath);
          const realSha256 = crypto
            .createHash('sha256')
            .update(fileBuffer)
            .digest('hex')
            .toLowerCase();

          await evidenceRepo.updateContentSha256(item.id, realSha256);
          reconciledCount++;
          logger.debug(
            `LegacyHashReconciler: Successfully computed real SHA-256 for evidence ${item.id} (${item.fileName}): ${realSha256}`
          );
        } catch (err: unknown) {
          logger.warn(
            `LegacyHashReconciler: Failed to read/hash legacy evidence ${item.id} (${item.filePath}): ${err instanceof Error ? err.message : String(err)}. Leaving hash unresolved.`
          );
          unresolvedCount++;
        }
      }

      logger.info(
        `LegacyHashReconciler: Reconciliation complete. Total: ${legacyRows.length}, Reconciled: ${reconciledCount}, Unresolved: ${unresolvedCount}`
      );

      return {
        totalLegacyFound: legacyRows.length,
        reconciledCount,
        unresolvedCount
      };
    });
  }

  const legacyRows = legacyRowsRes;
  if (legacyRows.length === 0) {
    return {
      totalLegacyFound: 0,
      reconciledCount: 0,
      unresolvedCount: 0
    };
  }

  logger.info(`LegacyHashReconciler: Found ${legacyRows.length} legacy evidence rows without content hashes. Beginning reconciliation...`);

  let reconciledCount = 0;
  let unresolvedCount = 0;

  for (const item of legacyRows) {
    try {
      const projectRoot = path.resolve(process.cwd(), uploadDir, item.projectId);
      const resolvedPath = path.resolve(process.cwd(), uploadDir, item.filePath);

      // Security check: ensure path is strictly within project upload directory
      if (!resolvedPath.startsWith(projectRoot)) {
        logger.warn(
          `LegacyHashReconciler: Path traversal or invalid location for evidence ${item.id} (${item.filePath}). Leaving hash unresolved.`
        );
        unresolvedCount++;
        continue;
      }

      if (!fs.existsSync(resolvedPath)) {
        logger.warn(
          `LegacyHashReconciler: Physical file missing on disk for legacy evidence ${item.id} (${item.filePath}). Leaving hash unresolved.`
        );
        unresolvedCount++;
        continue;
      }

      const fileBuffer = fs.readFileSync(resolvedPath);
      const realSha256 = crypto
        .createHash('sha256')
        .update(fileBuffer)
        .digest('hex')
        .toLowerCase();

      evidenceRepo.updateContentSha256(item.id, realSha256);
      reconciledCount++;
      logger.debug(
        `LegacyHashReconciler: Successfully computed real SHA-256 for evidence ${item.id} (${item.fileName}): ${realSha256}`
      );
    } catch (err: unknown) {
      logger.warn(
        `LegacyHashReconciler: Failed to read/hash legacy evidence ${item.id} (${item.filePath}): ${err instanceof Error ? err.message : String(err)}. Leaving hash unresolved.`
      );
      unresolvedCount++;
    }
  }

  logger.info(
    `LegacyHashReconciler: Reconciliation complete. Total: ${legacyRows.length}, Reconciled: ${reconciledCount}, Unresolved: ${unresolvedCount}`
  );

  return {
    totalLegacyFound: legacyRows.length,
    reconciledCount,
    unresolvedCount
  };
}
