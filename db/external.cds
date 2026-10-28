// ... and an entity with the same short name in another namespace (e.g. a facade on a remote schema)
namespace external;

entity Orders {
  key ORDER_ID : Integer;
      STATUS   : String;
}
