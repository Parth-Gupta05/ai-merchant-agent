# Catalog Agent Protocol & Capabilities Plan

As requested, we need to upgrade the **Catalog Agent** from a simple chatbot into a robust, structured API-like subagent. It must handle all 9 responsibilities (Search, Discovery, Details, Categories, Attributes, Semantic Search, Availability, Comparison, and Ingestion) while strictly adhering to a JSON-in/JSON-out protocol when communicating with other agents.

## User Review Required
Please review the proposed **Input Schema**, **Output Schema**, and **Internal Tools**. If you agree with this design, I will proceed to write the actual code implementing these schemas using Zod and LangChain's structured output parsers.

---

## 1. Agent-to-Agent Protocol

Other agents (like the Supervisor or Buyer Agent) will not chat with the Catalog Agent freely. They will invoke it using a strict JSON format.

### Input Schema (From Supervisor -> Catalog Agent)
The calling agent will pass an object like this:
```json
{
  "action": "SEARCH", // Enum: SEARCH, GET_DETAILS, COMPARE, CHECK_AVAILABILITY, INGEST
  "query": "show me what u have for bracelets under 1500rs", // The raw or extracted request
  "constraints": { // Optional deterministic filters extracted by the caller
    "maxPrice": 1500,
    "category": "spiritual_jewellery",
    "attributes": {
      "color": "black"
    }
  },
  "targetProductIds": [] // Used for GET_DETAILS, COMPARE, or CHECK_AVAILABILITY
}
```

### Output Schema (From Catalog Agent -> Supervisor)
The Catalog Agent will use Gemini's structured output capabilities to strictly return this JSON format to the caller:
```json
{
  "status": "SUCCESS", // Enum: SUCCESS, NO_RESULTS, ERROR
  "products": [
    {
      "productId": "BR001",
      "name": "Obsidian Protection Bracelet",
      "price": 999,
      "in_stock": true,
      "relevance_reason": "Matches the budget of <1500 and is a black spiritual bracelet."
    }
  ],
  "comparison_summary": null, // Populated only if action was COMPARE
  "message": "Found 1 highly relevant product matching the constraints."
}
```

---

## 2. Catalog Agent Internal Tools

To fulfill all responsibilities, the Catalog Agent will be equipped with the following tools (functions it can call to interact with MongoDB):

1. **`semanticProductSearchTool`**
   - **Handles:** Product search, Product discovery, Semantic search, Category understanding.
   - **How it works:** Uses `$vectorSearch` with Gemini embeddings + deterministic `$match` filters (price, category).

2. **`attributeMatchTool`**
   - **Handles:** Attribute matching.
   - **How it works:** A strict MongoDB query looking for exact matches in the `attributes` map (e.g., `attributes.color = "black"`).

3. **`getProductDetailsTool`**
   - **Handles:** Product details.
   - **How it works:** Looks up a specific `productId` and returns the full document (tags, use cases, descriptions).

4. **`checkAvailabilityTool`**
   - **Handles:** Availability lookup.
   - **How it works:** Fast lookup checking `inventory.available` and `inventory.quantity`.

5. **`compareProductsTool`**
   - **Handles:** Product comparison.
   - **How it works:** Takes an array of `productIds`, fetches their attributes, and asks Gemini to generate a structured comparison highlighting differences in price, materials, and use-cases.

6. **`ingestCatalogTool`**
   - **Handles:** Catalog ingestion.
   - **How it works:** Triggers the embedding generation process for new products added to the database.

---

## Next Steps
Once you approve this plan, I will:
1. Update `catalogAgent.js` to enforce the **JSON Structured Output** using Zod.
2. Build the missing internal tools (Comparison, Attribute Matching) in `productService.js`.
3. Wrap the Agent invocation so it accepts and returns exactly the schemas defined above.
