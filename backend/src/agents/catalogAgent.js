import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import dotenv from "dotenv";
import {
  semanticProductSearch,
  attributeMatch,
  getProductDetails,
  checkAvailability,
  compareProducts,
  getProductAddons
} from "../services/productService.js";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config();

// ------------------------------------------------------------------
// 1. Define Input and Output Schemas
// ------------------------------------------------------------------

export const CatalogInputSchema = z.object({
  action: z.enum(["SEARCH", "GET_DETAILS", "COMPARE", "CHECK_AVAILABILITY", "INGEST", "GET_ADDONS"]).describe("The core action the catalog agent needs to perform."),
  query: z.string().optional().describe("The core semantic search term (e.g., 'bracelets' or 'headphones'). Do not include pricing logic in this string."),
  constraints: z.object({
    minPrice: z.number().optional().describe("The minimum price bound. Used for upselling ranges."),
    maxPrice: z.number().optional().describe("The maximum price budget. If the user says 'under 1500', set this to 1500."),
    category: z.string().optional().describe("A specific category if one is strictly requested."),
    requestedQuantity: z.number().optional().describe("The specific quantity requested by the user."),
    attributes: z.array(z.object({
      key: z.string(),
      value: z.string()
    })).optional().describe("Specific physical attributes like color, material, etc.")
  }).optional().describe("Strict filters to apply to the search results."),
  targetProductIds: z.array(z.string()).optional()
});

export const CatalogOutputSchema = z.object({
  status: z.enum(["SUCCESS", "NO_RESULTS", "ERROR", "INSUFFICIENT_STOCK"]),
  products: z.array(z.object({
    productId: z.string(),
    name: z.string(),
    price: z.number(),
    in_stock: z.boolean(),
    available_quantity: z.number().nullable().optional().describe("The exact quantity currently in stock."),
    requested_quantity: z.number().nullable().optional().describe("The quantity requested by the user, if provided."),
    relevance_reason: z.string().nullable().optional()
  })),
  comparison_summary: z.string().nullable().optional(),
  addons: z.array(z.object({
    addonId: z.string(),
    name: z.string(),
    price: z.object({ amount: z.number(), currency: z.string() }).nullable().optional(),
    description: z.string().nullable().optional()
  })).nullable().optional().describe("Any cross-sell addons fetched for a product."),
  message: z.string()
});

// ------------------------------------------------------------------
// 2. Initialize Gemini Model configured for Structured Output
// ------------------------------------------------------------------

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-flash-lite-latest",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

const formatterllm = new ChatGoogleGenerativeAI({
  model: "gemini-flash-lite-latest",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

// ------------------------------------------------------------------
// 3. The Agent Execution Logic
// ------------------------------------------------------------------

export const invokeCatalogAgent = async (inputData) => {
  try {
    console.log("\n--- Catalog Agent Invoked ---");
    // Validate Input
    const parsedInput = CatalogInputSchema.parse(inputData);
    let rawResults = [];
    let systemPrompt = "";

    // 1. ROUTING: Call Deterministic Tools based on action
    switch (parsedInput.action) {
      case "SEARCH":
        if (parsedInput.constraints?.attributes && parsedInput.constraints.attributes.length > 0) {
          const attrObj = {};
          for (const attr of parsedInput.constraints.attributes) {
            attrObj[attr.key] = attr.value;
          }
          rawResults = await attributeMatch(attrObj);
        } else {
          rawResults = await semanticProductSearch(parsedInput.query, parsedInput.constraints);
        }
        break;

      case "GET_DETAILS":
      case "CHECK_AVAILABILITY":
        if (!parsedInput.targetProductIds || parsedInput.targetProductIds.length === 0) {
          throw new Error("targetProductIds required for GET_DETAILS or CHECK_AVAILABILITY");
        }
        rawResults = parsedInput.action === "GET_DETAILS"
          ? await getProductDetails(parsedInput.targetProductIds)
          : await checkAvailability(parsedInput.targetProductIds);
        break;

      case "COMPARE":
        if (!parsedInput.targetProductIds || parsedInput.targetProductIds.length < 2) {
          throw new Error("At least 2 targetProductIds required for COMPARE");
        }
        rawResults = await compareProducts(parsedInput.targetProductIds);
        systemPrompt = "You are comparing products. Analyze the raw DB results and provide a highly detailed `comparison_summary` explaining the differences in price, materials, and use-cases.";
        break;

      case "GET_ADDONS":
        let idsForAddons = parsedInput.targetProductIds;
        if (!idsForAddons || idsForAddons.length === 0) {
          if (parsedInput.query) {
            const searchRes = await semanticProductSearch(parsedInput.query, parsedInput.constraints);
            if (searchRes.length > 0) {
              idsForAddons = [searchRes[0].productId];
            } else {
              throw new Error("Could not find product to get addons for.");
            }
          } else {
            throw new Error("targetProductIds or query required for GET_ADDONS");
          }
        }
        rawResults = await getProductAddons(idsForAddons);
        systemPrompt = "Extract the raw addon details exactly as provided and return them in the 'addons' array format. Ensure you capture the addonId, name, price, and description.";
        break;

      case "INGEST":
        return { status: "SUCCESS", products: [], message: "Catalog ingestion handled by separate admin service." };
    }

    console.log("[DB Response]", JSON.stringify(rawResults, null, 2));

    // 2. LLM FORMATTING & REASONING: Convert raw DB results into the strict output schema
    const formatterLLM = formatterllm.withStructuredOutput(CatalogOutputSchema);

    let finalResponse;
    let attempts = 0;
    const maxAttempts = 3; // Initial try + 2 retries

    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.time(`[Catalog LLM Format] Attempt ${attempts}`);
        finalResponse = await formatterLLM.invoke([
          {
            role: "system",
            content: `You are the final formatting node of the Catalog Agent. 
            Your job is to take the user's initial request and the raw database results, and format them strictly into the requested JSON schema.
            
            CRITICAL INSTRUCTIONS:
            1. Populate 'relevance_reason' for each product explaining why it matches.
            2. INVENTORY CHECK: Look at 'inventory.quantity' in the raw DB results. Map this strictly to 'available_quantity' in your JSON.
            3. If the user provided a 'requestedQuantity' in the original request, compare it to the DB 'inventory.quantity'. 
               - If available < requested, you MUST set the overall status to 'INSUFFICIENT_STOCK'.
               - Populate 'requested_quantity' with the exact numeric value provided in the Original Request. DO NOT output the word Infinity.
            ${systemPrompt}`
          },
          {
            role: "user",
            content: `Original Request: ${JSON.stringify(parsedInput)} \n\nRaw DB Results: ${JSON.stringify(rawResults)}`
          }
        ]);
        console.timeEnd(`[Catalog LLM Format] Attempt ${attempts}`);
        break; // Success, exit retry loop
      } catch (err) {
        console.warn(`[Catalog Agent] Formatting LLM failed (Attempt ${attempts}/${maxAttempts}):`, err.message);
        if (attempts >= maxAttempts) {
          throw new Error(`LLM Formatting failed after 3 attempts: ${err.message}`);
        }
      }
    }

    console.log("--- Catalog Agent Finished ---");
    return finalResponse;

  } catch (error) {
    console.error("Catalog Agent Error:", error.message);
    return {
      status: "ERROR",
      products: [],
      message: error.message
    };
  }
};
