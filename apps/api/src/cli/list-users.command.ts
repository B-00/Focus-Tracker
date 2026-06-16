import { Command, CommandRunner } from 'nest-commander';
import { UsersService } from '../users/users.service';

/// `pnpm --filter @focus-tracker/api list-users`
///
/// Auth.md §6.3 (companion). Prints `id, email, displayName, createdAt` for
/// every user. Never prints any password material.
@Command({
  name: 'list-users',
  description: 'List all user accounts (id / email / displayName / createdAt).',
})
export class ListUsersCommand extends CommandRunner {
  constructor(private readonly users: UsersService) {
    super();
  }

  async run(): Promise<void> {
    const users = await this.users.listAll();
    if (users.length === 0) {
      // eslint-disable-next-line no-console
      console.log('\n(no users)\n');
      return;
    }
    // eslint-disable-next-line no-console
    console.table(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName ?? '',
        createdAt: u.createdAt.toISOString(),
      })),
    );
  }
}
