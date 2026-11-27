// Step definitions for `../features/posted_entry_immutability.feature`.
//
// A posted entry is append-only. The database enforces it with a trigger
// (`journal_entries` blocks UPDATE and DELETE — see the migration), which
// this in-memory fake cannot run. What this scenario can check, and does, is
// that no application path offers an edit or a delete in the first place: no
// registered ledger command updates or deletes a journal entry, and the
// journal-entries API route exposes reads only. The trigger itself is
// covered by the integration suite against a real database.
import { When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/postJournalEntry'
import '../../commands/reverseJournalEntry'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import * as journalEntriesRoute from '../../api/journal-entries/route'
import { JournalEntry } from '../../data/entities'
import { FakeEntityManager, activeEmOrNew } from '../support/world'

let offered: string[] = []
let snapshotBefore = ''

function entriesSnapshot(em: FakeEntityManager): Promise<string> {
  return em.find(JournalEntry, {}).then((entries) => JSON.stringify(entries))
}

When('I look for any way to edit or delete that entry', async function () {
  const em = activeEmOrNew()
  snapshotBefore = await entriesSnapshot(em)
  offered = []

  const mutatingCommand = /^ledger\.(update|edit|delete|remove|void|cancel)JournalEntr/i
  for (const id of commandRegistry.list()) {
    if (mutatingCommand.test(id)) offered.push(`command ${id}`)
  }

  const exportedMethods = Object.keys(journalEntriesRoute).filter((name) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(name))
  for (const method of exportedMethods) offered.push(`route ${method} /api/ledger/journal-entries`)
})

Then('none exists, and the entry is unchanged', async function () {
  assert.deepStrictEqual(offered, [], `expected no way to edit or delete a posted entry, found: ${offered.join(', ')}`)
  const em = activeEmOrNew()
  assert.strictEqual(await entriesSnapshot(em), snapshotBefore)
})
