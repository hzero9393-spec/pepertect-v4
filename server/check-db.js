const { PrismaClient } = require('./dist/lib/db.js');
const p = new PrismaClient();
(async () => {
  try {
    const rows = await p.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log('Tables:', JSON.stringify(rows, null, 2));
  } catch(e) { console.error('Error:', e.message); }
  await p.$disconnect();
})();