import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'module_configs' })
@Unique({ name: 'module_configs_module_name_unique', properties: ['moduleId', 'name'] })
export class ModuleConfig {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'module_id', type: 'text' })
  moduleId!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'value_json', type: 'json', nullable: true })
  valueJson!: unknown

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
