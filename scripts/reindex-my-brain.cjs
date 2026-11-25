const path = require('path');

async function run() {
  const storeModule = await import('../dist/db/store.js');
  const indexerModule = await import('../dist/vault/indexer.js');

  const vaultPath = path.join(__dirname, '..', 'my-brain');
  const oroDir = path.join(vaultPath, '.oro');
  const dbPath = path.join(oroDir, 'oro.db');

  console.log('Opening backup store at:', dbPath);
  const store = new storeModule.OroStore(dbPath);
  const indexer = new indexerModule.VaultIndexer(vaultPath, store);

  console.log('Indexing all notes in:', vaultPath);
  const result = indexer.indexAll(true);
  console.log('Backup index result:', result);

  store.close();
}

run().catch(err => {
  console.error('Backup re-index failed:', err);
  process.exit(1);
});
