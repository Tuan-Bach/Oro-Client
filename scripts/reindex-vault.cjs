const path = require('path');
const os = require('os');

async function run() {
  const storeModule = await import('../dist/db/store.js');
  const indexerModule = await import('../dist/vault/indexer.js');

  const vaultPath = path.join(os.homedir(), 'OroBrain');
  const oroDir = path.join(vaultPath, '.oro');
  const dbPath = path.join(oroDir, 'oro.db');

  console.log('Opening store at:', dbPath);
  const store = new storeModule.OroStore(dbPath);
  const indexer = new indexerModule.VaultIndexer(vaultPath, store);

  console.log('Indexing all notes in:', vaultPath);
  const result = indexer.indexAll(true);
  console.log('Index result:', result);

  const stats = store.getVaultStats();
  console.log('Updated Vault Stats:', stats);

  const allLinks = store.getAllLinks();
  console.log(`Total Links in Knowledge Graph: ${allLinks.length}`);

  store.close();
}

run().catch(err => {
  console.error('Re-index failed:', err);
  process.exit(1);
});
