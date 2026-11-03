import { DatabaseSync } from 'node:sqlite'
export function localDB(migrations) {
  const db = new DatabaseSync(':memory:')
  for (const migration of migrations) db.exec(migration)
  return {
    exec: sql => db.exec(sql),
    close: () => db.close(),
    prepare(sql) {
      const statement = db.prepare(sql)
      return { bind: (...values) => ({
        all: async () => ({ results: statement.all(...values) }),
        run: async () => ({ meta: { changes: Number(statement.run(...values).changes) } }),
      }) }
    },
  }
}
