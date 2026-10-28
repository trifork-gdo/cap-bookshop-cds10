# @sap/cds 10.2: database service resolves a top-level entity to a same-named entity in the model's namespace

## Description

Since `@sap/cds` **10.2.0**, a query on an entity **without a namespace** (`Orders`) runs against a different entity that has the **same short name in a namespace** (`external.Orders`). The namespaced entity must be in the file the compiler reads first. Both SELECT and INSERT are affected, whether the query names the entity as a string or passes its definition object.

With `@sap/cds` **10.1.1** the same project works. The only thing that changes between the two runs is `@sap/cds`; `@cap-js/sqlite` / `@cap-js/db-service` are 3.1.2 in both.

Two effects:

- **Initial data:** `db/data/Orders.csv` is inserted into table `external_Orders`. `cds deploy`, `cds watch`, `cds serve` and `cds.test` fail at startup.
- **Runtime:** `INSERT.into('Orders')` writes its row into `external_Orders` **without any error**, and `Orders` stays empty. `SELECT.from(Orders)` reads `external.Orders`.

### Cause

We isolated it to three pieces of code that combine:

1. **The model's namespace comes from the first source file.** `@sap/cds-compiler` 7.2.1, `lib/json/to-csn.js:237`: *"'namespace' for complete model is 'namespace' of first source"*. `cds.resolve('db/')` returns the files of `db/` in alphabetical order, so `db/external.cds` comes first and the model's `namespace` is `external`.
2. **The database service adopts that namespace.** `@sap/cds` `lib/srv/cds.Service.js:97-99`: a service without a service definition falls back to `this.model?.namespace`. So `cds.db.namespace === 'external'`, and `cds.db.entities` lists `external.Orders` under the short name `Orders`.
3. **10.2.0 checks service-local names first.** `@sap/cds` `lib/srv/srv-dispatch.js:104-108`, `_ensure_fqn`. The changelog entry is *"Resolution of service local names conflicting with top level definitions"*:

   ```diff
    if (srv.model) {
   +  if (name in srv.entities) return x[p] = srv.entities[name].name // service local name
      if (name in srv.model.definitions) return // already an fqn
   -  if (name in srv.entities) return x[p] = srv.entities[name].name
    }
   ```

   `Orders` is an existing fully qualified name in `model.definitions`, but it is now rewritten to `external.Orders` before that check runs. Passing the definition object doesn't help: the query's `ref` is still the string `'Orders'`.

The change makes sense for application services, where a service-local name should win. For a database service, the "local" names come from whichever namespace happens to be in the first file, so the result depends on file names.

### Evidence (all with @sap/cds 10.2.1 unless noted)

| Variant | Deploy with CSV | Runtime `INSERT.into('Orders')` |
|---|---|---|
| As in this repo | fails | row lands in `external_Orders` |
| `@sap/cds` 10.1.1 | OK | row lands in `Orders` |
| The two `_ensure_fqn` lines swapped back to the 10.1 order | OK | row lands in `Orders` |
| `db/external.cds` renamed to `db/zz-external.cds` (no longer the first file) | OK | row lands in `Orders` |
| A `db/index.cds` with no namespace (`using from './external'; using from './orders'; using from './schema';`) | OK | row lands in `Orders` |

Also on 10.2.1:

```
db.namespace: external | local short names: [ 'Orders' ]
SELECT.from('Orders').columns('book')               -> "book" not found in the elements of "external.Orders"
SELECT.from(<definition Orders>).columns('book')    -> "book" not found in the elements of "external.Orders"
SELECT.from('sap.capire.bookshop.Books')            -> OK
```

### Expected

For a database service, a name that exists in `model.definitions` resolves to that definition, as in 10.1. Possible fixes:
- keep the old order of the two checks for database services;
- don't give database services `model.namespace` as their namespace.

The result should not depend on which `.cds` file the compiler reads first.

## Steps to reproduce

The project is the capire bookshop sample plus four files:

| File | Content |
|---|---|
| `db/orders.cds` | `entity Orders { key ID : Integer; book : String; quantity : Integer; }` (no namespace) |
| `db/external.cds` | `namespace external; entity Orders { key ORDER_ID : Integer; STATUS : String; }` |
| `db/data/Orders.csv` | one row for `Orders` |
| `db/data/external-Orders.csv` | one row for `external.Orders` |

`repro.js` runs both cases against in-memory SQLite.

1. Clone the repository:
   ```sh
   git clone https://github.com/trifork-gdo/cap-bookshop-cds10.git
   cd cap-bookshop-cds10
   ```
2. Install the dependencies (`@sap/cds` 10.2.1, `@cap-js/sqlite` 3.1.2, pinned in `package.json`):
   ```sh
   npm install
   ```
3. Deploy with the CSV data:
   ```sh
   npm run repro
   ```
   Actual:
   ```
   1. deploy with CSV data: FAILED
      in cds.deploy(): table external_Orders has no column named ID in:
      INSERT INTO external_Orders (ID,book,quantity) SELECT ... FROM json_each(?)
   ```
4. Insert at runtime, with the CSV data skipped:
   ```sh
   npm run repro:runtime
   ```
   Actual:
   ```
   2. INSERT.into('Orders') at runtime, then the tables:
      Orders          : []
      external_Orders : [ { ORDER_ID: 1, STATUS: null } ]
   ```
5. Start the server. It fails at startup the same way as step 3:
   ```sh
   npx cds watch
   ```
6. To compare, install 10.1.1 and repeat steps 3 and 4:
   ```sh
   npm install @sap/cds@10.1.1
   npm run repro
   npm run repro:runtime
   ```
   Expected (and actual with 10.1.1):
   ```
   1. deploy with CSV data: OK

   2. INSERT.into('Orders') at runtime, then the tables:
      Orders          : [ { ID: 1, book: 'Jane Eyre', quantity: 1 } ]
      external_Orders : []
   ```

## Environment

- `@sap/cds` 10.2.1, `@sap/cds-compiler` 7.2.1. The change is listed under 10.2.0 in the changelog, but 10.2.0 is not on npm, so 10.2.1 is the first affected release we could install. 10.1.1 is not affected.
- `@cap-js/sqlite` 3.1.2 / `@cap-js/db-service` 3.1.2. The name is rewritten in `@sap/cds`'s dispatcher before the query reaches the database adapter, so `@cap-js/hana` should behave the same way. We verified this on SQLite only.
- Node.js 24.15.0, Linux

## Impact

We found this in a production project with this exact shape: our own `REQUEST_HEAD` table has no namespace, and a facade over another schema's `REQUEST_HEAD` sits in a namespace whose file sorts first. After the update to 10.2.1, every direct database query and write on `REQUEST_HEAD` (and two other tables) targeted the facade. On HANA that facade is a synonym to a table owned by another application. The runtime case gives no error when the target table happens to accept the row, so data can be written to the wrong table without anyone noticing.

**Workaround:** add a `db/index.cds` **without** a namespace that pulls in the other `db/*.cds` files (variant 5 above). The model's namespace is then undefined, and `_ensure_fqn` is skipped for the database service.
