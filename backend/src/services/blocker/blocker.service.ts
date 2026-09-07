import {
  OperationalBlocker,
  BlockerCategory,
  BlockerStatus,
  ProjectEvent
} from '../../models/domain.types.js';
import {
  OperationalBlockerRepository,
  operationalBlockerRepository as defaultBlockerRepo
} from '../../repositories/operational-blocker.repository.js';
import {
  ActivityRepository,
  activityRepository as defaultActivityRepo
} from '../../repositories/activity.repository.js';
import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../../repositories/project.repository.js';
import {
  ProjectEventRepository,
  projectEventRepository as defaultProjectEventRepo
} from '../../repositories/project-event.repository.js';
import {
  CreateBlockerDto,
  ResolveBlockerDto,
  ReportHazardDto
} from '../../validation/blocker.schema.js';
import { NotFoundError } from '../../errors/AppError.js';
import { SessionIdentity } from '../../models/domain.types.js';
import { logger } from '../../config/logger.js';

export interface BlockerServiceDependencies {
  blockerRepo?: OperationalBlockerRepository;
  activityRepo?: ActivityRepository;
  projectRepo?: ProjectRepository;
  projectEventRepo?: ProjectEventRepository;
}

export class BlockerService {
  private blockerRepo: OperationalBlockerRepository;
  private activityRepo: ActivityRepository;
  private projectRepo: ProjectRepository;
  private projectEventRepo: ProjectEventRepository;

  constructor(deps?: BlockerServiceDependencies) {
    this.blockerRepo = deps?.blockerRepo || defaultBlockerRepo;
    this.activityRepo = deps?.activityRepo || defaultActivityRepo;
    this.projectRepo = deps?.projectRepo || defaultProjectRepo;
    this.projectEventRepo = deps?.projectEventRepo || defaultProjectEventRepo;
  }

  reportBlocker(
    projectId: string,
    input: CreateBlockerDto,
    session?: SessionIdentity
  ): OperationalBlocker {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project '${projectId}' not found`);
    }

    let resolvedActivityId: string | null = null;
    let actName: string | null = null;
    let actExternalId: string | null = null;

    if (input.activityId) {
      // Check direct ID or external ID within the project
      let act = this.activityRepo.getById(input.activityId);
      if (act && act.projectId === projectId) {
        resolvedActivityId = act.id;
        actName = act.name;
        actExternalId = act.externalId;
      } else {
        const projectActivities = this.activityRepo.listByProjectId(projectId);
        const matchByExt = projectActivities.find(
          (a) => a.externalId.toLowerCase() === input.activityId?.toLowerCase()
        );
        if (matchByExt) {
          resolvedActivityId = matchByExt.id;
          actName = matchByExt.name;
          actExternalId = matchByExt.externalId;
        } else {
          throw new NotFoundError(
            `Activity '${input.activityId}' not found in project '${projectId}'`
          );
        }
      }
    }

    const reporterName = input.reporterName || session?.displayName || 'Worker Crew';

    const blocker = this.blockerRepo.create({
      projectId,
      activityId: resolvedActivityId,
      category: input.category,
      description: input.description,
      reporterName,
      reporterRole: input.reporterRole || null
    });

    // Record auditable project event
    const summaryTarget = actExternalId ? ` on ${actExternalId} (${actName})` : ' on General Site';
    this.projectEventRepo.create({
      projectId,
      eventType: 'blocker_reported',
      entityType: 'operational_blocker',
      entityId: blocker.id,
      summary: `Operational blocker reported [${blocker.category.toUpperCase()}]: ${blocker.description}${summaryTarget}`,
      payloadJson: JSON.stringify({
        blockerId: blocker.id,
        category: blocker.category,
        activityId: blocker.activityId,
        activityExternalId: actExternalId,
        reporterName: blocker.reporterName,
        reporterRole: blocker.reporterRole
      })
    });

    logger.info(
      `BlockerService: Logged [${blocker.category}] blocker on project '${projectId}' by '${reporterName}'`
    );

    return blocker;
  }

  listActiveByProject(projectId: string): OperationalBlocker[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project '${projectId}' not found`);
    }

    return this.blockerRepo.listActiveByProject(projectId);
  }

  listByProject(
    projectId: string,
    options?: { status?: BlockerStatus; activityId?: string }
  ): OperationalBlocker[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project '${projectId}' not found`);
    }

    let targetActivityId = options?.activityId;
    if (targetActivityId) {
      const act = this.activityRepo.getById(targetActivityId);
      if (!act) {
        const projectActivities = this.activityRepo.listByProjectId(projectId);
        const matchByExt = projectActivities.find(
          (a) => a.externalId.toLowerCase() === targetActivityId?.toLowerCase()
        );
        if (matchByExt) {
          targetActivityId = matchByExt.id;
        }
      }
    }

    return this.blockerRepo.listByProjectId(projectId, {
      status: options?.status,
      activityId: targetActivityId
    });
  }

  listByActivity(projectId: string, activityId: string): OperationalBlocker[] {
    return this.listByProject(projectId, { activityId });
  }

  resolveBlocker(
    projectId: string,
    blockerId: string,
    input?: ResolveBlockerDto,
    session?: SessionIdentity
  ): OperationalBlocker {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project '${projectId}' not found`);
    }

    const blocker = this.blockerRepo.findById(blockerId);
    if (!blocker || blocker.projectId !== projectId) {
      throw new NotFoundError(
        `Operational blocker '${blockerId}' not found in project '${projectId}'`
      );
    }

    if (blocker.status === 'resolved') {
      return blocker;
    }

    const resolved = this.blockerRepo.resolve(blockerId, projectId, input?.resolvedAt);
    if (!resolved) {
      throw new NotFoundError(`Operational blocker '${blockerId}' could not be resolved`);
    }

    // Record auditable project event
    this.projectEventRepo.create({
      projectId,
      eventType: 'blocker_resolved',
      entityType: 'operational_blocker',
      entityId: resolved.id,
      summary: `Operational blocker resolved [${resolved.category.toUpperCase()}]: ${resolved.description}`,
      payloadJson: JSON.stringify({
        blockerId: resolved.id,
        category: resolved.category,
        activityId: resolved.activityId,
        resolvedAt: resolved.resolvedAt,
        resolvedBy: session?.displayName || 'Authorized User'
      })
    });

    logger.info(`BlockerService: Resolved blocker '${blockerId}' on project '${projectId}'`);

    return resolved;
  }

  reportSafetyHazard(
    projectId: string,
    input: ReportHazardDto,
    session?: SessionIdentity
  ): ProjectEvent {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project '${projectId}' not found`);
    }

    const reporterName = input.reporterName || session?.displayName || 'Site Personnel';

    const event = this.projectEventRepo.create({
      projectId,
      eventType: 'safety_hazard_reported',
      entityType: 'safety_hazard',
      entityId: null,
      summary: `Safety hazard observed in ${input.workArea || 'Site'}: [${input.hazardType}] ${input.description}`,
      payloadJson: JSON.stringify({
        workArea: input.workArea || 'Site',
        hazardType: input.hazardType,
        description: input.description,
        reporterName,
        reporterRole: input.reporterRole || null,
        immediateActionTaken: input.immediateActionTaken || null,
        reportedAt: new Date().toISOString()
      })
    });

    logger.info(
      `BlockerService: Recorded safety hazard event in ${input.workArea || 'Site'} by '${reporterName}'`
    );

    return event;
  }

  countByRootCause(projectId: string): Record<BlockerCategory, number> {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project '${projectId}' not found`);
    }

    return this.blockerRepo.countByRootCause(projectId);
  }
}

export const blockerService: BlockerService = new BlockerService();
