# @sap/cds 10.2.1: an entity without a namespace is resolved to a namespaced entity with the same short name

## Summary

A model has an entity **without a namespace**, `Orders`, and an entity **in a namespace with the same short name**, `external.Orders`. With `@sap/cds` **10.2.1**, queries on `Orders` run against table `external_Orders`.

- **Initial data:** `db/data/Orders.csv` is inserted into `external_Orders`. `cds watch`, `cds serve` and `cds.test` therefore fail at startup.
- **Runtime:** `INSERT.into('Orders')` writes its row into `external_Orders`. No error is raised. `Orders` stays empty.

With `@sap/cds` **10.1.1** both cases work. The only change between the two runs is `@sap/cds`; `@cap-js/sqlite` is 3.1.2 (`@cap-js/db-service` 3.1.2) in both.

## Setup

This is the capire bookshop sample plus four small files:

| File | Content |
|---|---|
| `db/orders.cds` | `entity Orders { key ID : Integer; book : String; quantity : Integer; }`, with no namespace |
| `db/external.cds` | `namespace external; entity Orders { key ORDER_ID : Integer; STATUS : String; }` |
| `db/data/Orders.csv` | one row for `Orders` |
| `db/data/external-Orders.csv` | one row for `external.Orders` |

`repro.js` runs both cases against in-memory SQLite.

## Steps

```sh
npm install
npm run repro            # 1. deploy with CSV data
npm run repro:runtime    # 2. runtime INSERT, no CSV data involved
npx cds watch            # fails at startup the same way as 1.
```

## Actual (@sap/cds 10.2.1, @cap-js/sqlite 3.1.2, Node 24)

```
1. deploy with CSV data: FAILED
   in cds.deploy(): table external_Orders has no column named ID in:
   INSERT INTO external_Orders (ID,book,quantity) SELECT ... FROM json_each(?)

2. INSERT.into('Orders') at runtime, then the tables:
   Orders          : []
   external_Orders : [ { ORDER_ID: 1, STATUS: null } ]
```

## Expected (as with @sap/cds 10.1.1)

```
1. deploy with CSV data: OK

2. INSERT.into('Orders') at runtime, then the tables:
   Orders          : [ { ID: 1, book: 'Jane Eyre', quantity: 1 } ]
   external_Orders : []
```

To compare, run `npm install @sap/cds@10.1.1` and run the steps again.

## Observations

- The CSV-to-entity mapping is still right: `cds.deploy.resources()` maps `Orders.csv` to `Orders` and `external-Orders.csv` to `external.Orders`.
- The query is also built right: it targets `{ ref: ['Orders'] }`. Rendering it directly with `db.cqn2sql(...)` produces SQL against table `Orders`.
- The wrong target appears while the query runs through the database service. `@cap-js/db-service`'s `cqn4sql` (`transformQueryForInsertUpsert`) rebuilds `into` from an inferred `_target` that is already `external.Orders`.
- In `@sap/cds` 10.2.1, `cds.infer` (`lib/ql/cds.ql-infer.js`) resolves a ref through `ctx.model.definitions[name]` first, then falls back to `ctx.entities[name]`, where `ctx` is `q._srv ?? cds.context?.model ?? cds.model`. Resolving an unqualified name through a service's `entities` would explain a short-name match on another namespace. This is our reading of the code, not confirmed.

## Impact

We found this in a project with a real case of it: our own `REQUEST_HEAD` table has no namespace, and a facade of another schema's `REQUEST_HEAD` sits in namespace `cellnex.sdi`. After an update to 10.2.1, all integration tests (`cds.test`) and `cds watch` with test data failed. The runtime case is worse, because it writes into the wrong table without an error. We stay on 10.1.x until it is fixed.
