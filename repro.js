/**
 * Repro: an entity without namespace ('Orders') is resolved to another entity with the same
 * short name in a namespace ('external.Orders'), with @sap/cds 10.2.1 (fine with 10.1.1).
 *
 *   node repro.js
 *
 * 1. cds.deploy: db/data/Orders.csv is inserted into table external_Orders -> deploy fails
 * 2. runtime (CSVs skipped): INSERT.into('Orders') writes its row into table external_Orders
 */
const cds = require('@sap/cds')
const { INSERT } = cds.ql

async function deploy (withData) {
  const csn = await cds.load('*')
  const db = await cds.connect.to('db', { kind: 'sqlite', credentials: { url: ':memory:' } })
  if (!withData) cds.deploy.data = async () => {} // schema only, to show the runtime case on its own
  await cds.deploy(csn).to(db)
  return db
}

;(async () => {
  console.log('@sap/cds', cds.version, '| @cap-js/sqlite', require('@cap-js/sqlite/package.json').version)
  const step = process.argv[2] || 'deploy'
  if (step === 'deploy') {
    try { await deploy(true); console.log('\n1. deploy with CSV data: OK') }
    catch (e) { console.log('\n1. deploy with CSV data: FAILED\n  ', e.message.split('\n')[0]) }
  } else {
    const db = await deploy(false)
    await INSERT.into('Orders').entries({ ID: 1, book: 'Jane Eyre', quantity: 1 })
    console.log("\n2. INSERT.into('Orders') at runtime, then the tables:")
    console.log('   Orders          :', await db.run('SELECT * FROM Orders'))
    console.log('   external_Orders :', await db.run('SELECT * FROM external_Orders'))
  }
})()
