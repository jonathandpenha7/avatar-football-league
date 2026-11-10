import { createTestDb } from "../tests/db/harness";
createTestDb().then(() => console.log("Migrations applied cleanly")).catch((e) => { console.error(e.message); process.exit(1); });
