import { ProjectRepository, projectRepository as defaultProjectRepo } from '../repositories/project.repository.js';
import { Project, CreateProjectInput, UpdateProjectInput } from '../models/domain.types.js';
import { NotFoundError } from '../errors/AppError.js';

export interface ProjectService {
  createProject(input: CreateProjectInput): Project;
  listProjects(): Project[];
  getProject(id: string): Project;
  getProjectByCode(code: string): Project;
  updateProject(id: string, input: UpdateProjectInput): Project;
  deleteProject(id: string): boolean;
}

export class DefaultProjectService implements ProjectService {
  private projectRepo: ProjectRepository;

  constructor(projectRepo: ProjectRepository = defaultProjectRepo) {
    this.projectRepo = projectRepo;
  }

  createProject(input: CreateProjectInput): Project {
    const formattedInput: CreateProjectInput = {
      ...input,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      description: input.description !== undefined && input.description !== null 
        ? input.description.trim() 
        : null,
      status: input.status || 'active',
      startDate: input.startDate || null,
      targetEndDate: input.targetEndDate || null
    };

    return this.projectRepo.create(formattedInput) as any;
  }

  listProjects(): Project[] {
    return this.projectRepo.listAll() as any;
  }

  getProject(id: string): Project {
    const res: any = this.projectRepo.getById(id);
    if (res && typeof res.then === 'function') {
      return res.then((project: any) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${id}' not found`);
        }
        return project;
      }) as any;
    }
    if (!res) {
      throw new NotFoundError(`Project with ID '${id}' not found`);
    }
    return res;
  }

  getProjectByCode(code: string): Project {
    const res: any = this.projectRepo.getByCode(code.trim().toUpperCase());
    if (res && typeof res.then === 'function') {
      return res.then((project: any) => {
        if (!project) {
          throw new NotFoundError(`Project with code '${code}' not found`);
        }
        return project;
      }) as any;
    }
    if (!res) {
      throw new NotFoundError(`Project with code '${code}' not found`);
    }
    return res;
  }

  updateProject(id: string, input: UpdateProjectInput): Project {
    const existing: any = this.getProject(id);
    const formattedInput: UpdateProjectInput = {
      ...input,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
      ...(input.description !== undefined 
        ? { description: input.description !== null ? input.description.trim() : null } 
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate || null } : {}),
      ...(input.targetEndDate !== undefined ? { targetEndDate: input.targetEndDate || null } : {})
    };

    if (existing && typeof existing.then === 'function') {
      return existing.then(() => this.projectRepo.update(id, formattedInput)) as any;
    }
    return this.projectRepo.update(id, formattedInput) as any;
  }

  deleteProject(id: string): boolean {
    const existing: any = this.getProject(id);
    if (existing && typeof existing.then === 'function') {
      return existing.then(() => {
        const success: any = this.projectRepo.delete(id);
        if (success && typeof success.then === 'function') {
          return success.then((s: any) => {
            if (!s) throw new NotFoundError(`Project with ID '${id}' could not be deleted`);
            return true;
          });
        }
        if (!success) throw new NotFoundError(`Project with ID '${id}' could not be deleted`);
        return true;
      }) as any;
    }

    const success: any = this.projectRepo.delete(id);
    if (success && typeof success.then === 'function') {
      return success.then((s: any) => {
        if (!s) throw new NotFoundError(`Project with ID '${id}' could not be deleted`);
        return true;
      }) as any;
    }
    if (!success) {
      throw new NotFoundError(`Project with ID '${id}' could not be deleted`);
    }
    return true;
  }
}

export const projectService: ProjectService = new DefaultProjectService();
