import hello from './cli/hello';
import seedTodos from './cli/seed';

const cliCommands = [hello, seedTodos];
export type { TodoSeedArgs as ExampleTodoSeedArgs } from './cli/seed';
export default cliCommands;