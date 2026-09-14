# Catalog Agent Capabilities

The **Catalog Agent** is a specialized worker node responsible for making the merchant's catalog AI-readable and highly searchable. It receives strict JSON payloads from the Supervisor Agent and executes deterministic database operations before returning a structured JSON response.

Here are the primary functions the Catalog Agent can perform based on the `action` field:

## 1. SEARCH (`semanticProductSearch` & `attributeMatch`)
**Purpose:** Discovers products based on natural language queries or strict physical attributes.
- **Semantic Vector Search:** Uses the `gemini-embedding-2` model to convert the user's natural language query into a vector, running a `$vectorSearch` pipeline against the MongoDB cluster.
- **Attribute Matching:** If strict attributes are passed (e.g., `{"color": "black", "material": "obsidian"}`), it bypasses semantic search and performs an exact deterministic MongoDB match.
- **Constraints Handling:** Automatically filters out products that do not meet stock requirements (`inventory.available: true`) and applies strict filters like `maxPrice` and `category`. Note: Add-ons are ignored in general semantic searches as they live in a separate collection.

## 2. GET_DETAILS (`getProductDetails`)
**Purpose:** Fetches comprehensive information about specific products.
- Uses `targetProductIds` to query the database.
- Retrieves the full product document.
- **Add-ons Resolution:** Automatically runs `.populate('addons')` to fetch and embed any linked `Addon` documents (e.g., Gift Packaging) directly into the product response, which is crucial for frontend checkout display.

## 3. COMPARE (`compareProducts`)
**Purpose:** Allows users to compare multiple products side-by-side.
- Requires at least two `targetProductIds`.
- Retrieves the full details (including add-ons) for the target products.
- **LLM Synthesis:** Injects a strict system prompt instructing the formatting LLM to analyze the raw DB results and generate a highly detailed `comparison_summary` explaining the explicit differences in price, materials, features, and use-cases.

## 4. CHECK_AVAILABILITY (`checkAvailability`)
**Purpose:** A lightweight query to verify stock status.
- Queries the database for specific `targetProductIds`.
- Only projects the `productId` and `inventory` (quantity and availability) fields to minimize payload size and maximize speed. Useful for checking cart items before final checkout.

## 5. INGEST (Stubbed)
**Purpose:** Pushing new products to the catalog.
- Currently structured in the input schema to allow the agent to understand ingestion requests.
- Execution is delegated to a separate backend admin service for security and batch-processing stability.

---

### Internal Architecture Workflow
When the Catalog Agent is invoked, it follows a strict two-step execution process:
1. **Routing & Deterministic DB Execution:** Maps the `action` to the appropriate `productService.js` function and performs raw MongoDB queries.
2. **LLM Formatting & Reasoning:** Passes the raw DB results to a formatting node using the `gemini-3.6-flash` model. The LLM converts the messy DB output into the strict `CatalogOutputSchema` and populates the `relevance_reason` for each product to explain *why* it matched the user's initial query.
