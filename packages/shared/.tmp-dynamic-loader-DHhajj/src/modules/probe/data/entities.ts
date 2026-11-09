
    import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy'

    @Entity()
    export class ProbeEntity {
      static revision = 2

      @PrimaryKey()
      id!: string
    }
  