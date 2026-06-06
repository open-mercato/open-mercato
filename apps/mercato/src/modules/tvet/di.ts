import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { TraineeService } from './services/trainee.service'
import { CourseService } from './services/course.service'
import { CurriculumService } from './services/curriculum.service'

export function register(container: AppContainer) {
  container.register({
    traineeService: asClass(TraineeService).scoped(),
    courseService: asClass(CourseService).scoped(),
    curriculumService: asClass(CurriculumService).scoped(),
  })
}
