import { asClass, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { TraineeService } from './services/trainee.service'
import { CourseService } from './services/course.service'
import { CurriculumService } from './services/curriculum.service'
import { AcademicService } from './services/academic.service'
import {
  Trainee,
  Course,
  QualificationLevel,
  Sector,
  OccupationalStandard,
  CompetencyUnit,
  UnitElement,
  PerformanceCriteria,
  ClassGroup,
  Enrollment,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    // Services
    traineeService: asClass(TraineeService).scoped(),
    courseService: asClass(CourseService).scoped(),
    curriculumService: asClass(CurriculumService).scoped(),
    academicService: asClass(AcademicService).scoped(),

    // Entities
    Trainee: asValue(Trainee),
    Course: asValue(Course),
    QualificationLevel: asValue(QualificationLevel),
    Sector: asValue(Sector),
    OccupationalStandard: asValue(OccupationalStandard),
    CompetencyUnit: asValue(CompetencyUnit),
    UnitElement: asValue(UnitElement),
    PerformanceCriteria: asValue(PerformanceCriteria),
    ClassGroup: asValue(ClassGroup),
    Enrollment: asValue(Enrollment),
  })
}
