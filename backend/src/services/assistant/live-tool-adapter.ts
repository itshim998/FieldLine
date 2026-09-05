import {
  ActivityRepository,
  activityRepository as defaultActivityRepo
} from '../../repositories/activity.repository.js';
import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../../repositories/project.repository.js';
import {
  ActivityMatchRepository,
  activityMatchRepository as defaultActivityMatchRepo
} from '../../repositories/activity-match.repository.js';

export type { ActivityRepository, ProjectRepository, ActivityMatchRepository };

export interface LiveToolAdapterDeps {
  activityRepo: ActivityRepository;
  projectRepo: ProjectRepository;
  activityMatchRepo: ActivityMatchRepository;
}

export const defaultLiveToolAdapterDeps: LiveToolAdapterDeps = {
  activityRepo: defaultActivityRepo,
  projectRepo: defaultProjectRepo,
  activityMatchRepo: defaultActivityMatchRepo
};
